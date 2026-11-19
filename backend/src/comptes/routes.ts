import express, { NextFunction, Request, Response, Router } from 'express';
import { Db } from './db';
import {
  AccountError, deleteUser, EXTERNAL_PROVIDERS, ExternalProvider, getUser, isExternalProvider, isLoginProvider, isUsernameAvailable,
  linkExternal, listConnections, listUsers, loginWithExternal, setDisabled, setRole, setUsername, suggestUsername, unlinkExternal,
  updateProfile, User, validateUsername,
} from './accounts';
import { CONFIG_KEYS, ConfigKey, getConfig, providerStatus, publicUrl, setConfig } from './config';
import {
  adminAccess, AdminAccess, AuthContext, clientIp, cookieHeader, createSession, deleteSession, elevateSession, ELEVATION_TTL_MS,
  isTailscaleIp, listSessions, readCookie, resolveSession, revokeSession, SESSION_COOKIE, SESSION_TTL_MS,
} from './sessions';
import { authorizeUrl, callbackUrl, exchangeCode, lastfmProfileByName, OAUTH_PROVIDERS, OAuthProvider } from './oauth';
import {
  cancelAdminEnrollment, checkAdminEnrollment, completeBootstrap, consumeAdminEnrollment, consumeBootstrapCode, startAdminEnrollment,
} from './bootstrap';
import {
  authenticationOptions, deletePasskey, listPasskeys, registrationOptions, relyingParty, verifyAuthentication, verifyRegistration,
} from './passkeys';
import { pollQuickConnect, refreshSource, revokeJellyfin, startQuickConnect } from './sources';
import { gameDetail, listHistory, userStats } from './history';
import { DEFAULT_SCORING, sanitizeScoring, ScoringSettings } from './jeu';
import { randomToken, sha256 } from './secrets';

declare module 'express-serve-static-core' {
  interface Request {
    auth?: AuthContext | null;
  }
}

// --- Limitation de débit : fenêtre fixe en mémoire, par clé (IP + action) ---
const buckets = new Map<string, { count: number; resetAt: number }>();
export function rateLimited(key: string, max: number, windowMs: number, nowMs = Date.now()): boolean {
  const b = buckets.get(key);
  if (!b || b.resetAt <= nowMs) {
    if (buckets.size > 10_000) for (const [k, v] of buckets) if (v.resetAt <= nowMs) buckets.delete(k);
    buckets.set(key, { count: 1, resetAt: nowMs + windowMs });
    return false;
  }
  b.count += 1;
  return b.count > max;
}
export const resetRateLimits = () => buckets.clear();

const limit = (name: string, max: number, windowMs: number) => (req: Request, res: Response, next: NextFunction) => {
  if (rateLimited(`${name}:${clientIp(req)}`, max, windowMs)) {
    res.status(429).json({ error: 'Trop de tentatives : réessayez dans quelques minutes.', code: 'RATE_LIMITED' });
    return;
  }
  next();
};

export function publicUser(user: User) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.display_name,
    avatarUrl: user.avatar_url,
    role: user.role,
    bootstrap: !!user.bootstrap,
    needsUsername: !user.username,
  };
}

export const DEFAULT_GAME = { maxRounds: 10, roundDuration: 30, ...DEFAULT_SCORING };
export type GameDefaults = typeof DEFAULT_GAME;

export function sanitizeGameDefaults(input: unknown, current: GameDefaults = DEFAULT_GAME): GameDefaults {
  const s = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const int = (v: unknown, min: number, max: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.floor(v))) : d);
  const scoring: ScoringSettings = sanitizeScoring(s, current);
  return { maxRounds: int(s.maxRounds, 1, 50, current.maxRounds), roundDuration: int(s.roundDuration, 10, 120, current.roundDuration), ...scoring };
}

export function getGameDefaults(db: Db): GameDefaults {
  try {
    return sanitizeGameDefaults(JSON.parse(getConfig(db, 'gameDefaults') || '{}'));
  } catch {
    return { ...DEFAULT_GAME };
  }
}

/** Contexte de session à partir d'un en-tête Cookie (utilisé aussi par la poignée de main socket.io). */
export const authFromCookie = (db: Db, cookieHeaderValue: string | undefined) =>
  resolveSession(db, readCookie(cookieHeaderValue, SESSION_COOKIE));

interface OAuthState { provider: OAuthProvider; intent: 'login' | 'link'; userId: number | null; expiresAt: number }
const OAUTH_COOKIE = 'tg_oauth';
const OAUTH_TTL_MS = 10 * 60 * 1000;

export function createAccountRouter(db: Db): { router: Router; requireAdmin: express.RequestHandler } {
  const router = express.Router();
  const oauthStates = new Map<string, OAuthState>();
  const secure = () => publicUrl(db).startsWith('https:');
  const front = (p: string) => `${publicUrl(db)}${p}`;

  function setSessionCookie(res: Response, token: string | null) {
    res.append('Set-Cookie', cookieHeader(SESSION_COOKIE, token ?? '', { secure: secure(), maxAgeSec: token ? SESSION_TTL_MS / 1000 : 0 }));
  }

  function openSession(req: Request, res: Response, user: User, elevate = false) {
    const token = createSession(db, user.id, { ip: clientIp(req), userAgent: req.get('user-agent') });
    if (elevate) elevateSession(db, sha256(token), isTailscaleIp(clientIp(req)));
    setSessionCookie(res, token);
  }

  // Seulement nos chemins : les autres routes du serveur (invités, proxy média) gardent leurs règles.
  const OWN = ['/api', '/auth/compte'];
  router.use(OWN, express.json({ limit: '100kb' }));

  // Session lue à chaque requête : rien n'est mis en cache côté processus.
  router.use(OWN, (req, _res, next) => {
    req.auth = authFromCookie(db, req.headers.cookie);
    next();
  });

  // CSRF : toute écriture doit venir de l'origine publique du site.
  router.use(OWN, (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    if (req.get('origin') !== new URL(publicUrl(db)).origin) {
      res.status(403).json({ error: 'Origine refusée.', code: 'CSRF' });
      return;
    }
    next();
  });

  /** any : toute session ; setup : aussi pendant l'amorçage ; full : compte terminé (passkey d'amorçage + identifiant). */
  const needs = (level: 'any' | 'setup' | 'full') => (req: Request, res: Response, next: NextFunction) => {
    const ctx = req.auth;
    if (!ctx) return void res.status(401).json({ error: 'Connexion requise.', code: 'NOT_LOGGED_IN' });
    if (level === 'full' && ctx.user.bootstrap) {
      return void res.status(403).json({ error: 'Enregistrez d\'abord une passkey.', code: 'BOOTSTRAP_PASSKEY_REQUIRED' });
    }
    if (level === 'full' && !ctx.user.username) {
      return void res.status(403).json({ error: 'Choisissez d\'abord votre identifiant.', code: 'USERNAME_REQUIRED' });
    }
    next();
  };

  const access = (req: Request): AdminAccess => adminAccess(req.auth ?? null, clientIp(req));

  const requireAdmin: express.RequestHandler = (req, res, next) => {
    if (req.auth === undefined) req.auth = authFromCookie(db, req.headers.cookie);
    const a = access(req);
    if (a === 'ok' && !req.auth!.user.username) {
      return void res.status(403).json({ error: 'Choisissez d\'abord votre identifiant.', code: 'USERNAME_REQUIRED' });
    }
    if (a === 'ok') return next();
    const status = a === 'not_logged_in' ? 401 : 403;
    const messages: Record<Exclude<AdminAccess, 'ok'>, string> = {
      not_logged_in: 'Connexion requise.',
      not_admin: 'Réservé aux administrateurs.',
      bootstrap: 'Enregistrez d\'abord une passkey.',
      passkey_required: 'Confirmez avec votre passkey (ou connectez-vous depuis Tailscale validé).',
    };
    res.status(status).json({ error: messages[a], code: a.toUpperCase() });
  };

  // --- Public ---
  router.get('/api/config/fournisseurs', (_req, res) => {
    // Réglages par défaut des salons : la fenêtre de création part des mêmes valeurs que le serveur.
    res.json({ ...providerStatus(db), passkey: true, gameDefaults: getGameDefaults(db) });
  });

  router.get('/api/me', (req, res) => {
    const ctx = req.auth;
    if (!ctx) return void res.json({ user: null });
    res.json({ user: publicUser(ctx.user), admin: ctx.user.role === 'admin' ? access(req) : null });
  });

  router.post('/api/compte/deconnexion', (req, res) => {
    if (req.auth) deleteSession(db, req.auth.session.id_hash);
    setSessionCookie(res, null);
    res.json({ ok: true });
  });

  // --- OAuth (Google : connexion ou liaison ; YouTube et Last.fm : sources à lier) ---
  router.get('/auth/compte/:provider/start', limit('oauth', 30, 15 * 60_000), (req, res) => {
    const provider = req.params.provider as OAuthProvider;
    const intent = req.query.intent === 'link' ? 'link' : 'login';
    const back = intent === 'link' ? '/compte/connexions' : '/connexion';
    const status = providerStatus(db);
    if (!OAUTH_PROVIDERS.includes(provider) || !status[provider === 'lastfm' ? 'lastfmAuth' : provider]) return void res.redirect(front(`${back}?erreur=PROVIDER_DISABLED`));
    if (intent === 'login' && !isLoginProvider(provider)) return void res.redirect(front('/connexion?erreur=NOT_A_LOGIN_METHOD'));
    if (intent === 'link' && (!req.auth || req.auth.user.bootstrap || !req.auth.user.username)) return void res.redirect(front('/connexion'));
    const state = randomToken(24);
    for (const [k, v] of oauthStates) if (v.expiresAt < Date.now()) oauthStates.delete(k);
    oauthStates.set(state, { provider, intent, userId: req.auth?.user.id ?? null, expiresAt: Date.now() + OAUTH_TTL_MS });
    res.append('Set-Cookie', cookieHeader(OAUTH_COOKIE, state, { secure: secure(), maxAgeSec: OAUTH_TTL_MS / 1000, path: '/auth/compte' }));
    res.redirect(authorizeUrl(db, provider, state));
  });

  router.get('/auth/compte/:provider/callback', limit('oauth', 30, 15 * 60_000), async (req, res) => {
    const provider = req.params.provider as OAuthProvider;
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    const entry = oauthStates.get(state);
    oauthStates.delete(state);
    res.append('Set-Cookie', cookieHeader(OAUTH_COOKIE, '', { secure: secure(), maxAgeSec: 0, path: '/auth/compte' }));
    // Le state doit exister, correspondre au fournisseur et au cookie de ce navigateur (CSRF de connexion).
    if (!entry || entry.provider !== provider || entry.expiresAt < Date.now() || readCookie(req.headers.cookie, OAUTH_COOKIE) !== state) {
      return void res.redirect(front('/connexion?erreur=OAUTH_STATE'));
    }
    const back = entry.intent === 'link' ? '/compte/connexions' : '/connexion';
    const code = provider === 'lastfm' ? req.query.token : req.query.code;
    if (typeof code !== 'string' || !code || code.length > 2000) return void res.redirect(front(`${back}?erreur=OAUTH_DENIED`));
    try {
      const profile = await exchangeCode(db, provider, code);
      if (entry.intent === 'link') {
        if (!req.auth || req.auth.user.id !== entry.userId) return void res.redirect(front('/connexion?erreur=OAUTH_STATE'));
        linkExternal(db, entry.userId, profile);
        return void res.redirect(front(`/compte/connexions?ok=${provider}`));
      }
      const { user } = loginWithExternal(db, profile);
      openSession(req, res, user);
      res.redirect(front(user.username ? '/compte' : '/compte/bienvenue'));
    } catch (err: any) {
      if (!(err instanceof AccountError)) console.error(`Erreur OAuth ${provider}:`, err?.message);
      res.redirect(front(`${back}?erreur=${err instanceof AccountError ? err.code : 'OAUTH_FAILED'}`));
    }
  });

  // --- Passkeys : connexion ---
  const rp = () => relyingParty(publicUrl(db));
  router.post('/api/passkey/options', limit('passkey', 30, 15 * 60_000), async (_req, res) => {
    res.json(await authenticationOptions(db, rp()));
  });
  router.post('/api/passkey/connexion', limit('passkey', 30, 15 * 60_000), async (req, res) => {
    const user = await verifyAuthentication(db, rp(), req.body?.challengeId, req.body?.response);
    openSession(req, res, user, true);
    res.json({ user: publicUser(user) });
  });

  // --- Amorçage admin : code à usage unique ---
  router.post('/api/admin/amorcage', limit('bootstrap', 5, 15 * 60_000), (req, res) => {
    const user = consumeBootstrapCode(db, req.body?.code);
    if (!user) return void res.status(401).json({ error: 'Code invalide ou déjà utilisé.', code: 'BOOTSTRAP_INVALID' });
    console.log(`[admin] Code d'amorçage utilisé depuis ${clientIp(req)} : il est désormais invalide.`);
    openSession(req, res, user);
    res.json({ user: publicUser(user) });
  });

  // --- Identifiant ---
  router.get('/api/compte/identifiant/disponible', needs('any'), limit('username', 60, 60_000), (req, res) => {
    try {
      const name = validateUsername(req.query.u);
      const available = isUsernameAvailable(db, name, req.auth!.user.id);
      res.json({ available, username: name, reason: available ? null : 'USERNAME_TAKEN' });
    } catch (err: any) {
      res.json({ available: false, reason: err.code ?? 'USERNAME_INVALID', message: err.message });
    }
  });
  router.get('/api/compte/identifiant/suggestion', needs('any'), (req, res) => {
    const u = req.auth!.user;
    res.json({ username: suggestUsername(db, u.display_name) });
  });
  router.post('/api/compte/identifiant', needs('any'), limit('username-set', 20, 60_000), (req, res) => {
    if (req.auth!.user.bootstrap) throw new AccountError('BOOTSTRAP_PASSKEY_REQUIRED', 'Enregistrez d\'abord une passkey.', 403);
    res.json({ user: publicUser(setUsername(db, req.auth!.user.id, req.body?.username)) });
  });

  // Admin terminé : ajouter ou retirer une passkey exige l'accès admin complet, sinon une session
  // simplement connectée (Google, cookie volé) se fabriquerait une passkey puis l'admin.
  // Seules exceptions : l'amorçage (code unique) et l'enrôlement d'un promu (code unique, routes à part).
  const passkeyChange: express.RequestHandler = (req, res, next) => {
    const user = req.auth!.user;
    if (user.role !== 'admin' || user.bootstrap || access(req) === 'ok') return next();
    res.status(403).json({ error: 'Confirmez d\'abord avec une passkey existante (ou depuis Tailscale validé).', code: 'PASSKEY_REQUIRED' });
  };

  // --- Passkeys : enregistrement (possible pendant l'amorçage) ---
  router.post('/api/compte/passkeys/options', needs('setup'), passkeyChange, async (req, res) => {
    res.json(await registrationOptions(db, rp(), req.auth!.user));
  });
  router.post('/api/compte/passkeys', needs('setup'), passkeyChange, async (req, res) => {
    const { user, session } = req.auth!;
    await verifyRegistration(db, rp(), user, req.body?.challengeId, req.body?.response, req.body?.name);
    if (user.bootstrap) {
      completeBootstrap(db, user.id);
      // La passkey vient d'être créée avec vérification de l'utilisateur : la session est élevée.
      elevateSession(db, session.id_hash, isTailscaleIp(clientIp(req)));
    }
    res.json({ ok: true, user: publicUser(getUser(db, user.id)!) });
  });
  router.get('/api/compte/passkeys', needs('full'), (req, res) => res.json(listPasskeys(db, req.auth!.user.id)));
  router.delete('/api/compte/passkeys/:id', needs('full'), passkeyChange, (req, res) => {
    deletePasskey(db, getUser(db, req.auth!.user.id)!, req.params.id);
    res.json({ ok: true });
  });

  // Enrôlement d'un promu : le code remis par l'admin + une passkey créée maintenant activent le rôle.
  const enrollCode = (req: Request) => {
    if (!checkAdminEnrollment(db, req.auth!.user.id, req.body?.code)) {
      throw new AccountError('ENROLLMENT_INVALID', 'Code d\'enrôlement invalide ou expiré.', 401);
    }
  };
  router.post('/api/compte/enrolement-admin/options', needs('full'), limit('enroll', 10, 15 * 60_000), async (req, res) => {
    enrollCode(req);
    res.json(await registrationOptions(db, rp(), req.auth!.user));
  });
  router.post('/api/compte/enrolement-admin', needs('full'), limit('enroll', 10, 15 * 60_000), async (req, res) => {
    const { user, session } = req.auth!;
    enrollCode(req);
    await verifyRegistration(db, rp(), user, req.body?.challengeId, req.body?.response, req.body?.name);
    if (!consumeAdminEnrollment(db, user.id, req.body?.code)) {
      throw new AccountError('ENROLLMENT_INVALID', 'Code d\'enrôlement déjà utilisé.', 401);
    }
    setRole(db, user.id, 'admin');
    elevateSession(db, session.id_hash, isTailscaleIp(clientIp(req)));
    res.json({ ok: true, user: publicUser(getUser(db, user.id)!) });
  });

  // Élévation admin : assertion fraîche liée à la session, 12 h max.
  router.post('/api/compte/elevation/options', needs('full'), async (req, res) => {
    res.json(await authenticationOptions(db, rp(), req.auth!.user.id));
  });
  router.post('/api/compte/elevation', needs('full'), limit('passkey', 30, 15 * 60_000), async (req, res) => {
    const user = await verifyAuthentication(db, rp(), req.body?.challengeId, req.body?.response);
    if (user.id !== req.auth!.user.id) throw new AccountError('PASSKEY_INVALID', 'Passkey refusée.', 401);
    elevateSession(db, req.auth!.session.id_hash, isTailscaleIp(clientIp(req)));
    res.json({ ok: true, elevatedUntil: Date.now() + ELEVATION_TTL_MS });
  });

  // --- Profil ---
  router.get('/api/compte/accueil', needs('full'), (req, res) => {
    const id = req.auth!.user.id;
    res.json({ user: publicUser(getUser(db, id)!), stats: userStats(db, id), connections: listConnections(db, id) });
  });
  router.patch('/api/compte/profil', needs('full'), (req, res) => {
    res.json({ user: publicUser(updateProfile(db, req.auth!.user.id, req.body ?? {})) });
  });

  // --- Connexions / sources ---
  router.get('/api/compte/connexions', needs('full'), (req, res) => res.json(listConnections(db, req.auth!.user.id)));
  router.post('/api/compte/connexions/:provider/rafraichir', needs('full'), limit('refresh', 30, 15 * 60_000), async (req, res) => {
    const provider = req.params.provider as string;
    if (!isExternalProvider(provider) || provider === 'google') throw new AccountError('NOT_FOUND', 'Source inconnue.', 404);
    await refreshSource(db, req.auth!.user.id, provider);
    res.json(listConnections(db, req.auth!.user.id));
  });
  router.delete('/api/compte/connexions/:provider', needs('full'), async (req, res) => {
    const provider = req.params.provider as string;
    if (!isExternalProvider(provider)) throw new AccountError('NOT_FOUND', 'Fournisseur inconnu.', 404);
    const removed = unlinkExternal(db, req.auth!.user.id, provider as ExternalProvider);
    if (provider === 'jellyfin') await revokeJellyfin(removed);
    res.json(listConnections(db, req.auth!.user.id));
  });

  router.post('/api/compte/lastfm/pseudo', needs('full'), limit('lastfm-name', 20, 15 * 60_000), async (req, res) => {
    if (!providerStatus(db).lastfm) throw new AccountError('PROVIDER_DISABLED', "Last.fm n'est pas configuré sur ce serveur.", 403);
    linkExternal(db, req.auth!.user.id, await lastfmProfileByName(db, req.body?.username));
    res.json(listConnections(db, req.auth!.user.id));
  });

  router.post('/api/compte/jellyfin/initiate', needs('full'), limit('quickconnect', 10, 15 * 60_000), async (req, res) => {
    if (!providerStatus(db).jellyfin) throw new AccountError('PROVIDER_DISABLED', 'Jellyfin est désactivé sur ce serveur.', 403);
    res.json(await startQuickConnect(req.auth!.user.id, req.body?.serverUrl));
  });
  router.post('/api/compte/jellyfin/poll', needs('full'), limit('quickconnect-poll', 200, 15 * 60_000), async (req, res) => {
    const profile = await pollQuickConnect(req.auth!.user.id, req.body?.pendingId);
    if (!profile) return void res.json({ status: 'pending' });
    linkExternal(db, req.auth!.user.id, profile);
    res.json({ status: 'ok', connections: listConnections(db, req.auth!.user.id) });
  });

  // --- Sécurité ---
  router.get('/api/compte/sessions', needs('full'), (req, res) => {
    res.json(listSessions(db, req.auth!.user.id, req.auth!.session.id_hash));
  });
  router.delete('/api/compte/sessions/:id', needs('full'), (req, res) => {
    if (!revokeSession(db, req.auth!.user.id, req.params.id as string)) throw new AccountError('NOT_FOUND', 'Session introuvable.', 404);
    res.json({ ok: true });
  });
  router.delete('/api/compte', needs('full'), (req, res) => {
    const user = req.auth!.user;
    if (req.body?.confirm !== user.username) throw new AccountError('CONFIRM_REQUIRED', 'Saisissez votre identifiant pour confirmer.', 400);
    deleteUser(db, user.id);
    setSessionCookie(res, null);
    res.json({ ok: true });
  });

  // --- Historique ---
  router.get('/api/compte/historique', needs('full'), (req, res) => {
    res.json(listHistory(db, req.auth!.user.id, Number(req.query.page) || 1, Number(req.query.taille) || 10));
  });
  router.get('/api/compte/historique/:id', needs('full'), (req, res) => {
    const detail = gameDetail(db, req.auth!.user.id, Number(req.params.id));
    if (!detail) throw new AccountError('NOT_FOUND', 'Partie introuvable.', 404);
    res.json(detail);
  });

  // --- Admin ---
  router.get('/api/admin/etat', needs('setup'), (req, res) => {
    const { user, session } = req.auth!;
    if (user.role !== 'admin') throw new AccountError('NOT_ADMIN', 'Réservé aux administrateurs.', 403);
    res.json({
      access: access(req),
      ip: clientIp(req),
      onTailscale: isTailscaleIp(clientIp(req)),
      tailscaleValidatedAt: user.tailscale_validated_at,
      elevatedUntil: session.elevated_at ? session.elevated_at + ELEVATION_TTL_MS : null,
    });
  });

  router.get('/api/admin/config', requireAdmin, (_req, res) => {
    const values: Record<string, unknown> = {};
    for (const [k, def] of Object.entries(CONFIG_KEYS)) {
      if (k === 'gameDefaults') continue;
      const v = getConfig(db, k as ConfigKey);
      values[k] = def.secret ? { set: !!v } : v;
    }
    res.json({
      values,
      gameDefaults: getGameDefaults(db),
      providers: providerStatus(db),
      callbacks: Object.fromEntries(OAUTH_PROVIDERS.map((p) => [p, callbackUrl(db, p)])),
    });
  });

  router.put('/api/admin/config', requireAdmin, (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    for (const [k, def] of Object.entries(CONFIG_KEYS)) {
      if (k === 'gameDefaults' || !(k in body)) continue;
      let v = body[k];
      if ((k === 'jellyfinEnabled' || k === 'youtubeEnabled') && typeof v === 'boolean') v = String(v);
      if (v === null) { setConfig(db, k as ConfigKey, null); continue; }
      if (typeof v !== 'string' || v.length > 500) throw new AccountError('CONFIG_INVALID', `Valeur invalide : ${k}.`);
      // Secret vide = inchangé (le front ne connaît jamais la valeur actuelle).
      if (def.secret && v === '') continue;
      if (k === 'publicUrl') {
        try {
          const u = new URL(v);
          if (!['http:', 'https:'].includes(u.protocol)) throw new Error();
          v = u.origin;
        } catch {
          throw new AccountError('CONFIG_INVALID', 'URL publique invalide.');
        }
      }
      setConfig(db, k as ConfigKey, (v as string).trim());
    }
    if (body.gameDefaults !== undefined) {
      setConfig(db, 'gameDefaults', JSON.stringify(sanitizeGameDefaults(body.gameDefaults, getGameDefaults(db))));
    }
    res.json({ ok: true });
  });

  router.get('/api/admin/users', requireAdmin, (req, res) => {
    res.json(listUsers(db, typeof req.query.q === 'string' ? req.query.q.slice(0, 40) : ''));
  });
  router.patch('/api/admin/users/:id', requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    let user = getUser(db, id);
    if (!user) throw new AccountError('NOT_FOUND', 'Compte introuvable.', 404);
    // Promotion : aucun droit tout de suite, seulement un code d'enrôlement affiché une fois à l'admin.
    if (req.body?.role === 'admin' && user.role !== 'admin') {
      if (user.disabled) throw new AccountError('USER_DISABLED', 'Réactivez d\'abord ce compte.', 409);
      return void res.json({ user: publicUser(user), enrollment: startAdminEnrollment(db, id) });
    }
    if (req.body?.role !== undefined) {
      user = setRole(db, id, req.body.role);
      if (user.role === 'user') cancelAdminEnrollment(db, id);
    }
    if (typeof req.body?.disabled === 'boolean') {
      user = setDisabled(db, id, req.body.disabled);
      if (req.body.disabled) cancelAdminEnrollment(db, id); // désactiver annule un enrôlement en attente
    }
    res.json({ user: publicUser(user) });
  });

  router.get('/api/admin/securite', requireAdmin, (req, res) => {
    const user = req.auth!.user;
    res.json({
      passkeys: listPasskeys(db, user.id),
      tailscale: { validatedAt: user.tailscale_validated_at, onTailscale: isTailscaleIp(clientIp(req)), ip: clientIp(req) },
      admins: db.prepare("SELECT id, username, display_name AS displayName, disabled FROM users WHERE role = 'admin' ORDER BY id").all(),
    });
  });
  router.post('/api/admin/tailscale/valider', requireAdmin, (req, res) => {
    if (!isTailscaleIp(clientIp(req))) {
      throw new AccountError('NOT_TAILSCALE', `Cette requête ne vient pas d'une adresse Tailscale (adresse vue : ${clientIp(req) || 'inconnue'}).`, 400);
    }
    db.prepare('UPDATE users SET tailscale_validated_at = ? WHERE id = ?').run(Date.now(), req.auth!.user.id);
    res.json({ ok: true });
  });
  router.delete('/api/admin/tailscale', requireAdmin, (req, res) => {
    db.prepare('UPDATE users SET tailscale_validated_at = NULL WHERE id = ?').run(req.auth!.user.id);
    res.json({ ok: true });
  });

  router.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) return next(err);
    if (err instanceof AccountError) return void res.status(err.status).json({ error: err.message, code: err.code });
    if (err?.type === 'entity.parse.failed' || err?.type === 'entity.too.large') {
      return void res.status(400).json({ error: 'Requête invalide.', code: 'BAD_REQUEST' });
    }
    console.error('Erreur comptes:', err?.message);
    res.status(500).json({ error: 'Erreur interne.', code: 'INTERNAL' });
  });

  return { router, requireAdmin };
}

export { EXTERNAL_PROVIDERS };
