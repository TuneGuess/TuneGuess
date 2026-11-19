import { Db } from './db';
import { getConfig, providerStatus } from './config';
import { AccountError, ExternalProfile, ExternalProvider, getTokens, ProviderTokens, updateMeta, updateTokens, userIdentity } from './accounts';
import { refreshAccess } from './oauth';
import { randomToken } from './secrets';
import { GenericTrack } from '../MusicProvider';
import { YouTubeProvider } from '../YouTubeProvider';
import { LastFmProvider } from '../lastFmProvider';
import { JellyfinProvider } from '../JellyfinProvider';
import { normalizeServerUrl, outbound } from '../outbound';
import type { JellyfinSource, StoredTrack } from '../Room';

/** Fournisseurs de pistes, remplaçables dans les tests. */
export const trackProviders = {
  youtube: new YouTubeProvider(),
  jellyfin: new JellyfinProvider(),
  lastfm: (apiKey: string) => Object.assign(new LastFmProvider(), { apiKey }) as LastFmProvider,
};

const EXPIRY_MARGIN_MS = 60_000;
const MAX_TRACKS = 200;
const TRACK_ID = /^[\w-]{1,64}$/;

/** Jeton valide : rafraîchi automatiquement s'il expire dans la minute. */
export async function freshTokens(db: Db, userId: number, provider: ExternalProvider, force = false): Promise<ProviderTokens> {
  const t = getTokens(db, userId, provider);
  // Last.fm par pseudo seul : pas de jeton, les écoutes publiques suffisent.
  if (!t || (!t.accessToken && provider !== 'lastfm')) throw new AccountError('NOT_LINKED', 'Source non connectée.', 404);
  const expired = t.expiresAt !== null && t.expiresAt - Date.now() < EXPIRY_MARGIN_MS;
  if (provider === 'youtube' && (expired || force)) {
    if (!t.refreshToken) {
      updateMeta(db, t.identityId, { status: 'invalid' });
      throw new AccountError('RECONNECT_REQUIRED', 'Jeton expiré sans possibilité de rafraîchissement : reconnectez la source.', 409);
    }
    try {
      const next = await refreshAccess(db, t.refreshToken);
      updateTokens(db, t.identityId, next.accessToken, next.refreshToken, next.expiresAt);
    } catch {
      updateMeta(db, t.identityId, { status: 'invalid' });
      throw new AccountError('RECONNECT_REQUIRED', 'Le fournisseur a refusé le rafraîchissement : reconnectez la source.', 409);
    }
    return getTokens(db, userId, provider)!;
  }
  return t;
}

async function fetchSource(db: Db, userId: number, provider: ExternalProvider): Promise<GenericTrack[]> {
  const t = await freshTokens(db, userId, provider);
  const token = t.accessToken!;
  switch (provider) {
    case 'google': return []; // le compte, pas une source
    case 'youtube': return trackProviders.youtube.getUserTopTracks(token);
    case 'lastfm': {
      const lastfm = trackProviders.lastfm(getConfig(db, 'lastfmApiKey'));
      return [...await lastfm.getUserRecentTracks(t.subject), ...await lastfm.getUserTopTracks(t.subject)];
    }
    case 'jellyfin': {
      const opts = { serverUrl: t.meta.serverUrl, userId: t.meta.jellyfinUserId };
      return [...await trackProviders.jellyfin.getUserRecentTracks(token, opts), ...await trackProviders.jellyfin.getUserTopTracks(token, opts)];
    }
  }
}

/**
 * Pistes d'un compte, lues côté serveur sur toutes ses sources : rien ne transite par le navigateur.
 * Une source en échec n'empêche pas les autres ; son état est noté pour l'onglet Connexions.
 */
export async function loadAccountTracks(db: Db, userId: number): Promise<{ tracks: StoredTrack[]; jellyfin?: JellyfinSource; errors: string[] }> {
  const enabled = providerStatus(db);
  const linked = (['youtube', 'lastfm', 'jellyfin'] as const).filter((p) => enabled[p] && userIdentity(db, userId, p));
  const results = await Promise.allSettled(linked.map((p) => fetchSource(db, userId, p)));
  const seen = new Set<string>();
  const tracks: StoredTrack[] = [];
  const errors: string[] = [];
  results.forEach((r, i) => {
    const provider = linked[i];
    const identityId = userIdentity(db, userId, provider)!.id;
    if (r.status === 'rejected') {
      errors.push(provider);
      if (r.reason?.response?.status === 401 || r.reason?.response?.status === 403) updateMeta(db, identityId, { status: 'invalid' });
      return;
    }
    let count = 0;
    for (const t of r.value) {
      const key = `${t.provider}:${t.id}`;
      if (!t?.id || !TRACK_ID.test(t.id) || seen.has(key) || typeof t.name !== 'string') continue;
      seen.add(key);
      count++;
      if (tracks.length < MAX_TRACKS) {
        tracks.push({ id: t.id, provider: t.provider, name: t.name.slice(0, 300), artists: String(t.artists || '').slice(0, 300), albumName: t.albumName?.slice(0, 300) });
      }
    }
    updateMeta(db, identityId, { trackCount: count, tracksAt: Date.now(), status: 'ok' });
  });
  const jf = getTokens(db, userId, 'jellyfin');
  const jellyfin = jf?.accessToken && jf.meta.serverUrl ? { serverUrl: jf.meta.serverUrl as string, token: jf.accessToken } : undefined;
  return { tracks, jellyfin, errors };
}

/** Bouton « Rafraîchir » : nouveau jeton (OAuth) ou vérification (Jellyfin), puis recomptage des pistes. */
export async function refreshSource(db: Db, userId: number, provider: ExternalProvider): Promise<void> {
  const t = await freshTokens(db, userId, provider, provider === 'youtube');
  if (provider === 'jellyfin') {
    try {
      await outbound.get(`${normalizeServerUrl(t.meta.serverUrl)}/Users/Me`, { headers: jellyfinHeaders(t.accessToken!) });
    } catch {
      updateMeta(db, t.identityId, { status: 'invalid' });
      throw new AccountError('RECONNECT_REQUIRED', 'Jeton Jellyfin refusé : relancez QuickConnect.', 409);
    }
  }
  try {
    const tracks = await fetchSource(db, userId, provider);
    updateMeta(db, t.identityId, { trackCount: tracks.length, tracksAt: Date.now(), status: 'ok' });
  } catch {
    throw new AccountError('SOURCE_UNAVAILABLE', 'Connexion valide, mais les pistes sont momentanément indisponibles.', 502);
  }
}

// --- Jellyfin QuickConnect côté compte : le secret et le jeton restent sur le serveur ---
const jellyfinHeaders = (token?: string) => ({
  Authorization: `MediaBrowser Client="TuneGuess", Device="Web", DeviceId="tuneguess-server", Version="1.0.0"${token ? `, Token="${token}"` : ''}`,
});

interface PendingQuickConnect { serverUrl: string; secret: string; userId: number; expiresAt: number }
const pendingQc = new Map<string, PendingQuickConnect>();
export const QUICKCONNECT_TTL_MS = 5 * 60 * 1000;

export function jellyfinErrorCode(err: any): AccountError {
  if (err instanceof AccountError) return err;
  if (err?.code === 'EADDRBLOCKED') {
    return new AccountError('JELLYFIN_URL_REFUSED',
      'Adresse refusée : ce serveur TuneGuess n\'accepte pas les adresses de réseau local. En auto-hébergement, l\'administrateur peut l\'autoriser (JELLYFIN_ALLOW_PRIVATE_NETWORK=true).', 400);
  }
  if (err?.message === 'URL de serveur invalide' || err?.code === 'ERR_INVALID_URL') {
    return new AccountError('JELLYFIN_URL_INVALID', 'URL de serveur Jellyfin invalide (http:// ou https://).', 400);
  }
  if (err?.response?.status === 401 || err?.response?.status === 400) {
    return new AccountError('QUICKCONNECT_DISABLED', 'QuickConnect semble désactivé sur ce serveur Jellyfin.', 400);
  }
  return new AccountError('JELLYFIN_UNREACHABLE', 'Serveur Jellyfin injoignable depuis TuneGuess.', 502);
}

export async function startQuickConnect(userId: number, rawUrl: unknown): Promise<{ pendingId: string; code: string; expiresAt: number }> {
  try {
    const serverUrl = normalizeServerUrl(rawUrl);
    const { code, secret } = await trackProviders.jellyfin.initiateQuickConnect(serverUrl);
    if (typeof code !== 'string' || typeof secret !== 'string') throw new Error('Réponse QuickConnect invalide');
    for (const [id, p] of pendingQc) if (p.expiresAt < Date.now()) pendingQc.delete(id);
    const pendingId = randomToken(24);
    const expiresAt = Date.now() + QUICKCONNECT_TTL_MS;
    pendingQc.set(pendingId, { serverUrl, secret, userId, expiresAt });
    return { pendingId, code, expiresAt };
  } catch (err) {
    throw jellyfinErrorCode(err);
  }
}

/** null tant que le joueur n'a pas autorisé le code ; le profil prêt à lier ensuite. */
export async function pollQuickConnect(userId: number, pendingId: unknown): Promise<ExternalProfile | null> {
  const pending = typeof pendingId === 'string' ? pendingQc.get(pendingId) : undefined;
  if (!pending || pending.userId !== userId || pending.expiresAt < Date.now()) {
    if (typeof pendingId === 'string') pendingQc.delete(pendingId);
    throw new AccountError('QUICKCONNECT_EXPIRED', 'Code expiré : relancez QuickConnect.', 410);
  }
  try {
    const auth = await trackProviders.jellyfin.pollQuickConnect(pending.serverUrl, pending.secret);
    if (!auth) return null;
    pendingQc.delete(pendingId as string);
    const { data: me } = await outbound.get(`${pending.serverUrl}/Users/Me`, { headers: jellyfinHeaders(auth.token) });
    return {
      provider: 'jellyfin', subject: `${auth.serverId}:${auth.userId}`, label: `${me?.Name || 'Jellyfin'} (${new URL(pending.serverUrl).host})`,
      displayName: me?.Name || 'Jellyfin', accessToken: auth.token, expiresAt: null,
      meta: { serverUrl: pending.serverUrl, jellyfinUserId: auth.userId, serverId: auth.serverId },
    };
  } catch (err) {
    throw jellyfinErrorCode(err);
  }
}

/** Déconnexion Jellyfin : révoque la session côté serveur si possible (échec ignoré). */
export async function revokeJellyfin(t: ProviderTokens): Promise<void> {
  try {
    await outbound.post(`${normalizeServerUrl(t.meta.serverUrl)}/Sessions/Logout`, {}, { headers: jellyfinHeaders(t.accessToken!) });
  } catch {
    // Le jeton est supprimé de notre côté quoi qu'il arrive.
  }
}
