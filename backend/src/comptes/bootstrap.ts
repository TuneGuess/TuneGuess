import { Db, transaction } from './db';
import { createUser, realAdminCount, User } from './accounts';
import { randomToken, sameHash, sha256 } from './secrets';

const KEY = '_bootstrap_code';
export const RESET_CODE_TTL_MS = 60 * 60 * 1000;

/** Valeur stockée : `empreinte` (premier amorçage) ou `empreinte|expiration` (reset, enrôlement). */
const pendingRaw = (db: Db, key = KEY) =>
  (db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined)?.value ?? null;

const pendingHash = (db: Db, nowMs = Date.now(), key = KEY) => {
  const raw = pendingRaw(db, key);
  if (!raw) return null;
  const [hash, expires] = raw.split('|');
  return expires && nowMs >= Number(expires) ? null : hash;
};

/**
 * Au démarrage : sans administrateur (ou avec ADMIN_BOOTSTRAP_RESET=1), génère un code d'accès
 * à usage unique (160 bits), l'affiche une fois dans les logs et n'en garde que l'empreinte.
 * Retourne le code généré (pour les tests), sinon null.
 */
export function ensureBootstrap(db: Db, opts: { reset?: boolean; log?: (msg: string) => void } = {}): string | null {
  const log = opts.log ?? console.log;
  if (!opts.reset) {
    if (realAdminCount(db) > 0) {
      // Un code de reset non utilisé ne survit pas à un redémarrage sans ADMIN_BOOTSTRAP_RESET.
      db.prepare('DELETE FROM settings WHERE key = ?').run(KEY);
      return null;
    }
    if (pendingHash(db)) {
      log('[admin] Un code d\'amorçage non utilisé existe déjà (voir les logs de son premier affichage). ADMIN_BOOTSTRAP_RESET=1 pour en générer un nouveau.');
      return null;
    }
  }
  const code = randomToken(20);
  const value = opts.reset ? `${sha256(code)}|${Date.now() + RESET_CODE_TTL_MS}` : sha256(code);
  db.prepare('INSERT INTO settings (key, value, secret) VALUES (?, ?, 0) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(KEY, value);
  const line = '='.repeat(72);
  log([
    '', line,
    opts.reset ? '  TUNEGUESS : CODE D\'AMORÇAGE ADMIN RÉGÉNÉRÉ (ADMIN_BOOTSTRAP_RESET=1)' : '  TUNEGUESS : CODE D\'AMORÇAGE ADMIN (usage unique)',
    '', `  Code : ${code}`, '',
    opts.reset ? '  À saisir sur /admin/amorcage dans l\'heure. Il ne sert qu\'une fois, puis la session' : '  À saisir sur /admin/amorcage. Il ne sert qu\'une fois, puis la session',
    '  obtenue ne permet que d\'enregistrer une passkey. Il ne sera plus affiché.',
    line, '',
  ].join('\n'));
  return code;
}

/** Consomme le code : un seul usage possible, même si la suite n'aboutit pas. Crée le compte admin. */
export function consumeBootstrapCode(db: Db, code: unknown, nowMs = Date.now()): User | null {
  if (typeof code !== 'string' || code.length > 100) return null;
  const stored = pendingHash(db, nowMs);
  const raw = pendingRaw(db);
  const given = sha256(code.trim());
  if (!stored || !sameHash(stored, given)) return null;
  return transaction(db, () => {
    const { changes } = db.prepare('DELETE FROM settings WHERE key = ? AND value = ?').run(KEY, raw);
    if (changes === 0) return null;
    // Un amorçage précédent jamais terminé (aucune passkey) n'a plus de raison d'exister.
    db.prepare('DELETE FROM users WHERE bootstrap = 1 AND id NOT IN (SELECT user_id FROM passkeys)').run();
    return createUser(db, 'Administrateur', { role: 'admin', bootstrap: true });
  });
}

/** Appelé quand la première passkey du compte d'amorçage est enregistrée. */
export function completeBootstrap(db: Db, userId: number): void {
  db.prepare('UPDATE users SET bootstrap = 0 WHERE id = ?').run(userId);
}

// --- Enrôlement d'un admin promu : code à usage unique (1 h), remis par un autre canal ---
export const ENROLL_CODE_TTL_MS = 60 * 60 * 1000;
const enrollKey = (userId: number) => `_admin_enroll_${userId}`;

/** Génère le code d'enrôlement (remplace le précédent) ; seule l'empreinte est gardée. */
export function startAdminEnrollment(db: Db, userId: number, nowMs = Date.now()): { code: string; expiresAt: number } {
  const code = randomToken(20);
  const expiresAt = nowMs + ENROLL_CODE_TTL_MS;
  db.prepare('INSERT INTO settings (key, value, secret) VALUES (?, ?, 0) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(enrollKey(userId), `${sha256(code)}|${expiresAt}`);
  return { code, expiresAt };
}

export function checkAdminEnrollment(db: Db, userId: number, code: unknown, nowMs = Date.now()): boolean {
  if (typeof code !== 'string' || code.length > 100) return false;
  const stored = pendingHash(db, nowMs, enrollKey(userId));
  return !!stored && sameHash(stored, sha256(code.trim()));
}

/** Un seul usage : vrai seulement pour la requête qui efface le code. */
export function consumeAdminEnrollment(db: Db, userId: number, code: unknown, nowMs = Date.now()): boolean {
  if (!checkAdminEnrollment(db, userId, code, nowMs)) return false;
  return db.prepare('DELETE FROM settings WHERE key = ? AND value = ?').run(enrollKey(userId), pendingRaw(db, enrollKey(userId))).changes === 1;
}

export const cancelAdminEnrollment = (db: Db, userId: number) => void db.prepare('DELETE FROM settings WHERE key = ?').run(enrollKey(userId));
