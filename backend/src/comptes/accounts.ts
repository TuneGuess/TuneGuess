import { Db, transaction } from './db';
import { decryptOrNull, encryptOrNull } from './secrets';

export class AccountError extends Error {
  constructor(public code: string, message: string, public status = 400) {
    super(message);
  }
}

/** Création de compte et connexion : Google uniquement (+ passkey). */
export const LOGIN_PROVIDERS = ['google'] as const;
/** Identités liables : Google (le compte) puis les sources YouTube, Last.fm, Jellyfin. */
export const EXTERNAL_PROVIDERS = ['google', 'youtube', 'lastfm', 'jellyfin'] as const;
export type LoginProvider = (typeof LOGIN_PROVIDERS)[number];
export type ExternalProvider = (typeof EXTERNAL_PROVIDERS)[number];
export const isLoginProvider = (p: string): p is LoginProvider => (LOGIN_PROVIDERS as readonly string[]).includes(p);
export const isExternalProvider = (p: string): p is ExternalProvider => (EXTERNAL_PROVIDERS as readonly string[]).includes(p);

export interface User {
  id: number;
  username: string | null;
  display_name: string;
  avatar_url: string | null;
  role: 'user' | 'admin';
  disabled: number;
  bootstrap: number;
  tailscale_validated_at: number | null;
  created_at: number;
}

export interface IdentityRow {
  id: number;
  user_id: number;
  provider: ExternalProvider;
  subject: string;
  label: string | null;
  access_enc: string | null;
  refresh_enc: string | null;
  expires_at: number | null;
  meta: string;
  created_at: number;
}

/** Ce qu'un fournisseur externe renvoie après connexion. */
export interface ExternalProfile {
  provider: ExternalProvider;
  subject: string;
  label: string;
  displayName: string;
  avatarUrl?: string | null;
  /** null pour Google-connexion : aucun scope de données demandé, rien à garder. */
  accessToken: string | null;
  refreshToken?: string | null;
  expiresAt?: number | null;
  meta?: Record<string, unknown>;
}

const now = () => Date.now();

export function cleanDisplayName(raw: unknown, fallback = 'Joueur'): string {
  // Texte brut : l'échappement se fait à l'affichage (Vue).
  // eslint-disable-next-line no-control-regex -- les caractères de contrôle sont retirés volontairement
  const name = typeof raw === 'string' ? raw.replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 20) : '';
  return name || fallback;
}

export function cleanAvatarUrl(raw: unknown): string | null {
  if (raw === null || raw === '') return null;
  if (typeof raw !== 'string' || raw.length > 500) throw new AccountError('AVATAR_INVALID', 'Lien d\'avatar invalide.');
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:') throw new Error();
    return url.toString();
  } catch {
    throw new AccountError('AVATAR_INVALID', 'L\'avatar doit être une adresse https.');
  }
}

// --- Identifiant utilisateur (@identifiant) ---
export const USERNAME_RE = /^[a-z0-9_.]{3,20}$/;
export const RESERVED_USERNAMES = new Set([
  'admin', 'administrateur', 'administrator', 'root', 'system', 'systeme', 'tuneguess', 'support', 'moderateur',
  'moderator', 'modo', 'staff', 'equipe', 'team', 'aide', 'help', 'contact', 'official', 'officiel', 'null', 'undefined',
  'anonyme', 'anonymous', 'invite', 'guest', 'api', 'compte', 'connexion', 'me', 'moi',
]);

export function validateUsername(raw: unknown): string {
  const name = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (!USERNAME_RE.test(name)) {
    throw new AccountError('USERNAME_INVALID', 'Identifiant invalide : 3 à 20 caractères parmi a-z, 0-9, « _ » et « . ».');
  }
  if (RESERVED_USERNAMES.has(name)) throw new AccountError('USERNAME_RESERVED', 'Cet identifiant est réservé.');
  return name;
}

export function isUsernameAvailable(db: Db, name: string, exceptUserId?: number): boolean {
  const row = db.prepare('SELECT id FROM users WHERE username = ?').get(name) as { id: number } | undefined;
  return !row || row.id === exceptUserId;
}

/** Proposition dérivée d'un nom quelconque : normalisée, suffixe numérique si prise ou réservée. */
export function suggestUsername(db: Db, base: string): string {
  let stem = base.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/\s+/g, '_').replace(/[^a-z0-9_.]/g, '').replace(/^[._]+|[._]+$/g, '').slice(0, 16);
  if (stem.length < 3) stem = 'joueur';
  for (let i = 1; i < 10_000; i++) {
    const candidate = i === 1 ? stem : `${stem.slice(0, 20 - String(i).length)}${i}`;
    if (!RESERVED_USERNAMES.has(candidate) && isUsernameAvailable(db, candidate)) return candidate;
  }
  return `joueur${Date.now() % 1_000_000}`;
}

/** Choix ou changement : l'ancien identifiant est libéré aussitôt. */
export function setUsername(db: Db, userId: number, raw: unknown): User {
  const name = validateUsername(raw);
  if (!isUsernameAvailable(db, name, userId)) throw new AccountError('USERNAME_TAKEN', 'Cet identifiant est déjà pris.', 409);
  try {
    db.prepare('UPDATE users SET username = ? WHERE id = ?').run(name, userId);
  } catch (err: any) {
    if (String(err?.message).includes('UNIQUE')) throw new AccountError('USERNAME_TAKEN', 'Cet identifiant est déjà pris.', 409);
    throw err;
  }
  return getUser(db, userId)!;
}

// --- Comptes ---
export function getUser(db: Db, id: number): User | null {
  return (db.prepare('SELECT * FROM users WHERE id = ?').get(id) as User | undefined) ?? null;
}

export function createUser(db: Db, displayName: string, opts: { avatarUrl?: string | null; role?: 'user' | 'admin'; bootstrap?: boolean } = {}): User {
  const { lastInsertRowid } = db.prepare('INSERT INTO users (display_name, avatar_url, role, bootstrap, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(cleanDisplayName(displayName), opts.avatarUrl ?? null, opts.role ?? 'user', opts.bootstrap ? 1 : 0, now());
  return getUser(db, Number(lastInsertRowid))!;
}

function identity(db: Db, provider: ExternalProvider, subject: string): IdentityRow | null {
  return (db.prepare('SELECT * FROM identities WHERE provider = ? AND subject = ?').get(provider, subject) as IdentityRow | undefined) ?? null;
}

export function userIdentity(db: Db, userId: number, provider: ExternalProvider): IdentityRow | null {
  return (db.prepare('SELECT * FROM identities WHERE user_id = ? AND provider = ?').get(userId, provider) as IdentityRow | undefined) ?? null;
}

function assertUsable(user: User | null): User {
  if (!user) throw new AccountError('NOT_FOUND', 'Compte introuvable.', 404);
  if (user.disabled) throw new AccountError('ACCOUNT_DISABLED', 'Ce compte est désactivé.', 403);
  return user;
}

/** Connexion (ou création de compte) par Google. */
export function loginWithExternal(db: Db, p: ExternalProfile): { user: User; created: boolean } {
  if (!isLoginProvider(p.provider)) throw new AccountError('NOT_A_LOGIN_METHOD', 'Ce fournisseur ne permet pas de se connecter.', 400);
  return transaction(db, () => {
    const existing = identity(db, p.provider, p.subject);
    if (existing) {
      saveTokens(db, existing.id, p);
      return { user: assertUsable(getUser(db, existing.user_id)), created: false };
    }
    const user = createUser(db, p.displayName, { avatarUrl: p.avatarUrl ?? null });
    insertExternal(db, user.id, p);
    return { user, created: true };
  });
}

/** Liaison à un compte connecté : refus si l'identité appartient à un autre compte (pas de fusion). */
export function linkExternal(db: Db, userId: number, p: ExternalProfile): void {
  transaction(db, () => {
    const existing = identity(db, p.provider, p.subject);
    if (existing && existing.user_id !== userId) {
      throw new AccountError('IDENTITY_TAKEN', 'Ce compte externe est déjà lié à un autre compte TuneGuess.', 409);
    }
    if (existing) {
      saveTokens(db, existing.id, p);
      return;
    }
    if (userIdentity(db, userId, p.provider)) {
      throw new AccountError('PROVIDER_ALREADY_LINKED', 'Un autre compte de ce fournisseur est déjà lié : déconnectez-le d\'abord.', 409);
    }
    insertExternal(db, userId, p);
  });
}

function insertExternal(db: Db, userId: number, p: ExternalProfile) {
  db.prepare(`INSERT INTO identities (user_id, provider, subject, label, access_enc, refresh_enc, expires_at, meta, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(userId, p.provider, p.subject, p.label, encryptOrNull(p.accessToken), encryptOrNull(p.refreshToken), p.expiresAt ?? null,
      JSON.stringify({ ...(p.meta ?? {}), status: 'ok' }), now());
}

function saveTokens(db: Db, identityId: number, p: Pick<ExternalProfile, 'accessToken' | 'refreshToken' | 'expiresAt' | 'label' | 'meta'>) {
  const current = db.prepare('SELECT refresh_enc, meta FROM identities WHERE id = ?').get(identityId) as { refresh_enc: string | null; meta: string };
  // Google ne renvoie pas toujours de refresh token : on garde l'ancien.
  const refresh = p.refreshToken ? encryptOrNull(p.refreshToken) : current.refresh_enc;
  const meta = { ...JSON.parse(current.meta || '{}'), ...(p.meta ?? {}), status: 'ok' };
  db.prepare('UPDATE identities SET label = ?, access_enc = ?, refresh_enc = ?, expires_at = ?, meta = ? WHERE id = ?')
    .run(p.label, encryptOrNull(p.accessToken), refresh, p.expiresAt ?? null, JSON.stringify(meta), identityId);
}

export interface ProviderTokens {
  identityId: number;
  subject: string;
  accessToken: string | null;
  refreshToken: string | null;
  expiresAt: number | null;
  meta: Record<string, any>;
}

export function getTokens(db: Db, userId: number, provider: ExternalProvider): ProviderTokens | null {
  const row = userIdentity(db, userId, provider);
  if (!row) return null;
  return {
    identityId: row.id,
    subject: row.subject,
    accessToken: decryptOrNull(row.access_enc),
    refreshToken: decryptOrNull(row.refresh_enc),
    expiresAt: row.expires_at,
    meta: JSON.parse(row.meta || '{}'),
  };
}

export function updateTokens(db: Db, identityId: number, accessToken: string, refreshToken: string | null, expiresAt: number | null) {
  const current = db.prepare('SELECT label FROM identities WHERE id = ?').get(identityId) as { label: string };
  saveTokens(db, identityId, { accessToken, refreshToken, expiresAt, label: current.label });
}

export function updateMeta(db: Db, identityId: number, patch: Record<string, unknown>) {
  const current = db.prepare('SELECT meta FROM identities WHERE id = ?').get(identityId) as { meta: string };
  db.prepare('UPDATE identities SET meta = ? WHERE id = ?').run(JSON.stringify({ ...JSON.parse(current.meta || '{}'), ...patch }), identityId);
}

/** Méthodes qui permettent de se connecter : Google et passkeys. */
export function countLoginMethods(db: Db, userId: number): number {
  const ids = db.prepare("SELECT COUNT(*) AS n FROM identities WHERE user_id = ? AND provider = 'google'").get(userId) as { n: number };
  const keys = db.prepare('SELECT COUNT(*) AS n FROM passkeys WHERE user_id = ?').get(userId) as { n: number };
  return ids.n + keys.n;
}

/** Les sources (YouTube, Last.fm, Jellyfin) se retirent librement ; Google est le compte lui-même et ne se délie pas. */
export function unlinkExternal(db: Db, userId: number, provider: ExternalProvider): ProviderTokens {
  return transaction(db, () => {
    const tokens = getTokens(db, userId, provider);
    if (!tokens) throw new AccountError('NOT_LINKED', 'Ce fournisseur n\'est pas connecté.', 404);
    if (isLoginProvider(provider)) {
      throw new AccountError('LAST_METHOD', 'La liaison Google est votre compte : elle ne peut pas être retirée (vous pouvez supprimer le compte).', 409);
    }
    db.prepare('DELETE FROM identities WHERE id = ?').run(tokens.identityId);
    return tokens;
  });
}

export function updateProfile(db: Db, userId: number, patch: { displayName?: unknown; avatarUrl?: unknown }): User {
  const user = assertUsable(getUser(db, userId));
  const displayName = patch.displayName === undefined ? user.display_name : cleanDisplayName(patch.displayName, user.display_name);
  const avatarUrl = patch.avatarUrl === undefined ? user.avatar_url : cleanAvatarUrl(patch.avatarUrl);
  db.prepare('UPDATE users SET display_name = ?, avatar_url = ? WHERE id = ?').run(displayName, avatarUrl, userId);
  return getUser(db, userId)!;
}

export const countPasskeys = (db: Db, userId: number) =>
  (db.prepare('SELECT COUNT(*) AS n FROM passkeys WHERE user_id = ?').get(userId) as { n: number }).n;

// Vrai admin : amorçage terminé et au moins une passkey (un amorçage en cours ne compte pas).
export const realAdminCount = (db: Db) =>
  (db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND disabled = 0 AND bootstrap = 0 AND id IN (SELECT user_id FROM passkeys)").get() as { n: number }).n;

function assertNotLastAdmin(db: Db, user: User) {
  const real = user.role === 'admin' && !user.disabled && !user.bootstrap && countPasskeys(db, user.id) > 0;
  if (real && realAdminCount(db) <= 1) {
    throw new AccountError('LAST_ADMIN', 'Impossible : c\'est le dernier administrateur.', 409);
  }
}

export function deleteUser(db: Db, userId: number): void {
  transaction(db, () => {
    const user = getUser(db, userId);
    if (!user) throw new AccountError('NOT_FOUND', 'Compte introuvable.', 404);
    assertNotLastAdmin(db, user);
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  });
}

export function setRole(db: Db, userId: number, role: unknown): User {
  if (role !== 'user' && role !== 'admin') throw new AccountError('ROLE_INVALID', 'Rôle invalide.');
  return transaction(db, () => {
    const user = getUser(db, userId);
    if (!user) throw new AccountError('NOT_FOUND', 'Compte introuvable.', 404);
    if (role === 'user') assertNotLastAdmin(db, user);
    // Le rôle admin ne s'active qu'après l'enrôlement (code + passkey) : jamais sans passkey.
    if (role === 'admin' && user.role !== 'admin' && countPasskeys(db, userId) === 0) {
      throw new AccountError('ENROLLMENT_REQUIRED', "Le compte doit d'abord s'enrôler avec une passkey.", 409);
    }
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, userId);
    return getUser(db, userId)!;
  });
}

export function setDisabled(db: Db, userId: number, disabled: boolean): User {
  return transaction(db, () => {
    const user = getUser(db, userId);
    if (!user) throw new AccountError('NOT_FOUND', 'Compte introuvable.', 404);
    if (disabled) {
      assertNotLastAdmin(db, user);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
    }
    db.prepare('UPDATE users SET disabled = ? WHERE id = ?').run(disabled ? 1 : 0, userId);
    return getUser(db, userId)!;
  });
}

/** Liste admin, filtrable par identifiant (ou pseudo). */
export function listUsers(db: Db, search = '') {
  const q = `%${search.trim().toLowerCase().replace(/^@/, '').replace(/[%_\\]/g, (c) => '\\' + c)}%`;
  return db.prepare(`SELECT u.id, u.username, u.display_name AS displayName, u.role, u.disabled, u.created_at AS createdAt,
      (SELECT GROUP_CONCAT(provider) FROM identities i WHERE i.user_id = u.id) AS providers,
      (SELECT COUNT(*) FROM passkeys p WHERE p.user_id = u.id) AS passkeys,
      EXISTS (SELECT 1 FROM settings s WHERE s.key = '_admin_enroll_' || u.id) AS enrollPending
    FROM users u
    WHERE COALESCE(u.username, '') LIKE ? ESCAPE '\\' OR LOWER(u.display_name) LIKE ? ESCAPE '\\'
    ORDER BY u.id LIMIT 200`).all(q, q);
}

/** Vue publique des connexions : jamais de jeton. L'e-mail vient du fournisseur, en lecture seule. */
export function listConnections(db: Db, userId: number) {
  const rows = db.prepare('SELECT * FROM identities WHERE user_id = ?').all(userId) as unknown as IdentityRow[];
  return {
    providers: rows.map((r) => {
      const meta = JSON.parse(r.meta || '{}');
      return {
        provider: r.provider,
        label: r.label,
        email: typeof meta.email === 'string' ? meta.email : null,
        loginMethod: isLoginProvider(r.provider),
        expiresAt: r.expires_at,
        trackCount: typeof meta.trackCount === 'number' ? meta.trackCount : null,
        status: meta.status === 'invalid' ? 'invalid' : 'ok',
        serverUrl: r.provider === 'jellyfin' ? meta.serverUrl ?? null : undefined,
        linkedAt: r.created_at,
      };
    }),
    methods: countLoginMethods(db, userId),
  };
}
