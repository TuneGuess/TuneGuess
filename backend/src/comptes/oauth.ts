import axios from 'axios';
import { createHash } from 'crypto';
import { Db } from './db';
import { getConfig, publicUrl } from './config';
import { AccountError, ExternalProfile } from './accounts';

/** Client HTTP des fournisseurs (remplaçable dans les tests). Destinations fixes : pas d'URL utilisateur ici. */
export const oauthHttp = axios.create({ timeout: 10_000, maxRedirects: 0 });

/** google = connexion au compte ; youtube = source optionnelle (même client Google, consentement incrémental). */
export type OAuthProvider = 'google' | 'youtube' | 'lastfm';
export const OAUTH_PROVIDERS: OAuthProvider[] = ['google', 'youtube', 'lastfm'];

// Connexion : scopes non sensibles uniquement (pas de vérification Google requise).
export const GOOGLE_SCOPES = 'openid email profile';
// Source YouTube : seul scope sensible, demandé au clic « Connecter YouTube » (openid/email pour identifier le compte).
export const YOUTUBE_SCOPES = 'openid email https://www.googleapis.com/auth/youtube.readonly';

export const callbackUrl = (db: Db, provider: OAuthProvider) => `${publicUrl(db)}/auth/compte/${provider}/callback`;

const form = (data: Record<string, string>) => new URLSearchParams(data).toString();
const FORM_HEADERS = { 'Content-Type': 'application/x-www-form-urlencoded' };

export function authorizeUrl(db: Db, provider: OAuthProvider, state: string): string {
  const redirect = callbackUrl(db, provider);
  if (provider === 'google') {
    return 'https://accounts.google.com/o/oauth2/v2/auth?' + form({
      response_type: 'code', client_id: getConfig(db, 'googleClientId'), redirect_uri: redirect, scope: GOOGLE_SCOPES,
      prompt: 'select_account', state,
    });
  }
  if (provider === 'youtube') {
    return 'https://accounts.google.com/o/oauth2/v2/auth?' + form({
      response_type: 'code', client_id: getConfig(db, 'googleClientId'), redirect_uri: redirect, scope: YOUTUBE_SCOPES,
      // Refresh token nécessaire : les pistes sont relues côté serveur après l'expiration du jeton (1 h).
      access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state,
    });
  }
  // Last.fm ne renvoie pas de state : il voyage dans l'URL de retour.
  return 'https://www.last.fm/api/auth/?' + form({ api_key: getConfig(db, 'lastfmApiKey'), cb: `${redirect}?state=${encodeURIComponent(state)}` });
}

/** Signature Last.fm : md5 des paramètres triés (clé+valeur concaténées) suivis du secret. */
export function lastfmSignature(params: Record<string, string>, secret: string): string {
  const base = Object.keys(params).filter((k) => k !== 'format' && k !== 'callback').sort().map((k) => k + params[k]).join('');
  return createHash('md5').update(base + secret, 'utf8').digest('hex');
}

const expiresAt = (seconds: unknown) => (typeof seconds === 'number' ? Date.now() + seconds * 1000 : null);

async function googleCode(db: Db, provider: 'google' | 'youtube', code: string) {
  const { data: tok } = await oauthHttp.post('https://oauth2.googleapis.com/token', form({
    code, client_id: getConfig(db, 'googleClientId'), client_secret: getConfig(db, 'googleClientSecret'),
    redirect_uri: callbackUrl(db, provider), grant_type: 'authorization_code',
  }), { headers: FORM_HEADERS });
  if (!tok?.access_token) throw new AccountError('OAUTH_FAILED', 'Google a refusé la connexion.', 502);
  return tok;
}

async function googleUserinfo(accessToken: string) {
  const { data: me } = await oauthHttp.get('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!me?.sub) throw new AccountError('OAUTH_FAILED', 'Profil Google illisible.', 502);
  return me;
}

/** Échange le code (ou le jeton Last.fm) contre un profil + jetons. */
export async function exchangeCode(db: Db, provider: OAuthProvider, code: string): Promise<ExternalProfile> {
  if (provider === 'google') {
    const tok = await googleCode(db, 'google', code);
    const me = await googleUserinfo(tok.access_token);
    // Le jeton ne sert qu'à lire le profil : rien n'est conservé.
    return {
      provider: 'google', subject: String(me.sub), label: me.email || me.name || 'Google', displayName: me.name || 'Joueur',
      avatarUrl: typeof me.picture === 'string' && me.picture.startsWith('https://') ? me.picture : null,
      accessToken: null, meta: { email: me.email ?? null },
    };
  }
  if (provider === 'youtube') {
    const tok = await googleCode(db, 'youtube', code);
    const me = await googleUserinfo(tok.access_token);
    return {
      provider: 'youtube', subject: String(me.sub), label: me.email || me.name || 'YouTube', displayName: me.name || 'YouTube',
      accessToken: tok.access_token, refreshToken: tok.refresh_token ?? null, expiresAt: expiresAt(tok.expires_in),
    };
  }
  const params = { method: 'auth.getSession', api_key: getConfig(db, 'lastfmApiKey'), token: code };
  const { data } = await oauthHttp.get('https://ws.audioscrobbler.com/2.0/', {
    params: { ...params, api_sig: lastfmSignature(params, getConfig(db, 'lastfmApiSecret')), format: 'json' },
  });
  const session = data?.session;
  if (!session?.name || !session?.key) throw new AccountError('OAUTH_FAILED', 'Session Last.fm refusée.', 502);
  // Clé de session Last.fm : sans expiration.
  return { provider: 'lastfm', subject: String(session.name), label: session.name, displayName: session.name, accessToken: session.key, expiresAt: null };
}

/** Rafraîchit le jeton YouTube à partir du refresh token. */
export async function refreshAccess(db: Db, refreshToken: string) {
  const { data } = await oauthHttp.post('https://oauth2.googleapis.com/token', form({
    client_id: getConfig(db, 'googleClientId'), client_secret: getConfig(db, 'googleClientSecret'),
    refresh_token: refreshToken, grant_type: 'refresh_token',
  }), { headers: FORM_HEADERS });
  if (!data?.access_token) throw new AccountError('REFRESH_FAILED', 'Rafraîchissement refusé.', 502);
  return { accessToken: data.access_token as string, refreshToken: (data.refresh_token as string) ?? null, expiresAt: expiresAt(data.expires_in) };
}

/** Liaison Last.fm par pseudo seul (sans web auth) : vérifie que le profil existe. */
export async function lastfmProfileByName(db: Db, rawName: unknown): Promise<ExternalProfile> {
  const name = typeof rawName === 'string' ? rawName.trim() : '';
  if (!/^[A-Za-z][\w-]{1,14}$/.test(name)) throw new AccountError('LASTFM_INVALID', 'Pseudo Last.fm invalide.', 400);
  let user;
  try {
    ({ data: { user } } = await oauthHttp.get('https://ws.audioscrobbler.com/2.0/', {
      params: { method: 'user.getInfo', user: name, api_key: getConfig(db, 'lastfmApiKey'), format: 'json' },
    }));
  } catch {
    user = null;
  }
  if (!user?.name) throw new AccountError('LASTFM_NOT_FOUND', 'Profil Last.fm introuvable.', 404);
  return { provider: 'lastfm', subject: String(user.name), label: user.name, displayName: user.name, accessToken: null, expiresAt: null, meta: { byName: true } };
}
