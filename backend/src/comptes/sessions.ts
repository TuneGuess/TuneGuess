import type { IncomingMessage } from 'http';
import net from 'net';
import { Db } from './db';
import { getUser, User } from './accounts';
import { randomToken, sha256 } from './secrets';

export const SESSION_COOKIE = 'tg_session';
export const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;
export const ELEVATION_TTL_MS = 12 * 3600 * 1000;

export interface SessionRow {
  id_hash: string;
  user_id: number;
  created_at: number;
  last_seen_at: number;
  expires_at: number;
  ip: string | null;
  user_agent: string | null;
  elevated_at: number | null;
  elevated_tailscale: number;
}

export interface AuthContext {
  session: SessionRow;
  user: User;
}

/** Retourne le jeton brut (pour le cookie) ; seule son empreinte est stockée. */
export function createSession(db: Db, userId: number, info: { ip?: string; userAgent?: string } = {}, nowMs = Date.now()): string {
  const token = randomToken(32);
  db.prepare('INSERT INTO sessions (id_hash, user_id, created_at, last_seen_at, expires_at, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(sha256(token), userId, nowMs, nowMs, nowMs + SESSION_TTL_MS, info.ip ?? null, (info.userAgent ?? '').slice(0, 200) || null);
  return token;
}

/** Expiration glissante : chaque usage repousse la fin à 30 j (écriture au plus une fois par minute). */
export function resolveSession(db: Db, token: string | undefined, nowMs = Date.now()): AuthContext | null {
  if (!token || token.length > 100) return null;
  const idHash = sha256(token);
  const session = db.prepare('SELECT * FROM sessions WHERE id_hash = ?').get(idHash) as SessionRow | undefined;
  if (!session) return null;
  if (session.expires_at <= nowMs) {
    db.prepare('DELETE FROM sessions WHERE id_hash = ?').run(idHash);
    return null;
  }
  const user = getUser(db, session.user_id);
  if (!user || user.disabled) return null;
  if (nowMs - session.last_seen_at > 60_000) {
    session.last_seen_at = nowMs;
    session.expires_at = nowMs + SESSION_TTL_MS;
    db.prepare('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id_hash = ?').run(nowMs, session.expires_at, idHash);
  }
  return { session, user };
}

export function deleteSession(db: Db, idHash: string): void {
  db.prepare('DELETE FROM sessions WHERE id_hash = ?').run(idHash);
}

export function listSessions(db: Db, userId: number, currentHash: string) {
  const rows = db.prepare('SELECT * FROM sessions WHERE user_id = ? ORDER BY last_seen_at DESC').all(userId) as unknown as SessionRow[];
  return rows.map((s) => ({
    id: s.id_hash.slice(0, 16),
    createdAt: s.created_at,
    lastSeenAt: s.last_seen_at,
    ip: s.ip,
    userAgent: s.user_agent,
    current: s.id_hash === currentHash,
  }));
}

/** Révocation par l'identifiant court affiché (16 premiers caractères de l'empreinte). */
export function revokeSession(db: Db, userId: number, shortId: string): boolean {
  if (!/^[0-9a-f]{16}$/.test(shortId)) return false;
  const { changes } = db.prepare("DELETE FROM sessions WHERE user_id = ? AND substr(id_hash, 1, 16) = ?").run(userId, shortId);
  return changes > 0;
}

export function elevateSession(db: Db, idHash: string, fromTailscale: boolean, nowMs = Date.now()): void {
  db.prepare('UPDATE sessions SET elevated_at = ?, elevated_tailscale = ? WHERE id_hash = ?').run(nowMs, fromTailscale ? 1 : 0, idHash);
}

export function readCookie(header: string | undefined, name: string): string | undefined {
  for (const part of (header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) {
      try {
        return decodeURIComponent(part.slice(i + 1).trim());
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

export function cookieHeader(name: string, value: string, opts: { secure: boolean; maxAgeSec: number; path?: string }): string {
  return [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${opts.path ?? '/'}`,
    `Max-Age=${opts.maxAgeSec}`,
    'HttpOnly',
    'SameSite=Lax',
    ...(opts.secure ? ['Secure'] : []),
  ].join('; ');
}

// --- Réseau ---
const TAILSCALE = new net.BlockList();
TAILSCALE.addSubnet('100.64.0.0', 10);
TAILSCALE.addSubnet('fd7a:115c:a1e0::', 48, 'ipv6');

export function normalizeIp(ip: string | undefined): string {
  const raw = (ip || '').trim();
  return raw.startsWith('::ffff:') && net.isIPv4(raw.slice(7)) ? raw.slice(7) : raw;
}

export function isTailscaleIp(ip: string | undefined): boolean {
  const clean = normalizeIp(ip);
  const family = net.isIP(clean);
  return family !== 0 && TAILSCALE.check(clean, family === 6 ? 'ipv6' : 'ipv4');
}

/**
 * IP du client : celle du socket TCP. `X-Forwarded-For` n'est lu que si TRUST_PROXY est défini
 * (Express calcule alors `req.ip` selon la règle `trust proxy` donnée).
 */
export function clientIp(req: IncomingMessage & { ip?: string }, env = process.env): string {
  return normalizeIp(env.TRUST_PROXY ? req.ip : req.socket.remoteAddress);
}

// --- Accès admin, évalué à chaque requête ---
export type AdminAccess = 'ok' | 'not_logged_in' | 'not_admin' | 'bootstrap' | 'passkey_required';

export function adminAccess(ctx: AuthContext | null, ip: string, nowMs = Date.now()): AdminAccess {
  if (!ctx) return 'not_logged_in';
  if (ctx.user.role !== 'admin') return 'not_admin';
  if (ctx.user.bootstrap) return 'bootstrap';
  const onTailscale = isTailscaleIp(ip);
  // Tailscale validé + requête depuis Tailscale : accès direct, la passkey n'est pas demandée.
  if (ctx.user.tailscale_validated_at && onTailscale) return 'ok';
  const { elevated_at: at, elevated_tailscale: viaTailscale } = ctx.session;
  // Élévation par passkey liée à la session, 12 h max, perdue si elle a été faite sur Tailscale et que l'IP en sort.
  if (at && nowMs - at < ELEVATION_TTL_MS && !(viaTailscale && !onTailscale)) return 'ok';
  return 'passkey_required';
}
