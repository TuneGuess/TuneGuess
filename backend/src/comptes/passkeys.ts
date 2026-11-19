import * as swa from '@simplewebauthn/server';
import { Db } from './db';
import { AccountError, countLoginMethods, getUser, User } from './accounts';
import { randomToken } from './secrets';

/** Point d'indirection (remplaçable dans les tests) : aucune crypto WebAuthn faite main. */
export const webauthn = {
  generateRegistrationOptions: swa.generateRegistrationOptions,
  verifyRegistrationResponse: swa.verifyRegistrationResponse,
  generateAuthenticationOptions: swa.generateAuthenticationOptions,
  verifyAuthenticationResponse: swa.verifyAuthenticationResponse,
};

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

export interface RelyingParty {
  rpID: string;
  origin: string;
}

export function relyingParty(publicUrl: string): RelyingParty {
  const url = new URL(publicUrl);
  return { rpID: url.hostname, origin: url.origin };
}

interface PasskeyRow {
  id: string;
  user_id: number;
  public_key: Uint8Array;
  counter: number;
  transports: string | null;
  name: string | null;
  created_at: number;
  last_used_at: number | null;
}

function saveChallenge(db: Db, challenge: string, kind: 'reg' | 'auth', userId: number | null): string {
  const id = randomToken(18);
  db.prepare('DELETE FROM challenges WHERE expires_at < ?').run(Date.now());
  db.prepare('INSERT INTO challenges (id, challenge, kind, user_id, expires_at) VALUES (?, ?, ?, ?, ?)')
    .run(id, challenge, kind, userId, Date.now() + CHALLENGE_TTL_MS);
  return id;
}

/** Un défi ne sert qu'une fois. */
function takeChallenge(db: Db, id: unknown, kind: 'reg' | 'auth'): { challenge: string; user_id: number | null } {
  const row = typeof id === 'string'
    ? db.prepare('SELECT * FROM challenges WHERE id = ? AND kind = ?').get(id, kind) as { challenge: string; user_id: number | null; expires_at: number } | undefined
    : undefined;
  if (row) db.prepare('DELETE FROM challenges WHERE id = ?').run(id as string);
  if (!row || row.expires_at < Date.now()) throw new AccountError('CHALLENGE_EXPIRED', 'Défi expiré : recommencez.', 400);
  return row;
}

export async function registrationOptions(db: Db, rp: RelyingParty, user: User) {
  const existing = db.prepare('SELECT id, transports FROM passkeys WHERE user_id = ?').all(user.id) as { id: string; transports: string | null }[];
  const options = await webauthn.generateRegistrationOptions({
    rpName: 'TuneGuess',
    rpID: rp.rpID,
    userName: user.username || `compte-${user.id}`,
    userDisplayName: user.display_name,
    userID: new TextEncoder().encode(String(user.id)),
    attestationType: 'none',
    excludeCredentials: existing.map((p) => ({ id: p.id, transports: p.transports ? JSON.parse(p.transports) : undefined })),
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
  });
  return { challengeId: saveChallenge(db, options.challenge, 'reg', user.id), options };
}

export async function verifyRegistration(db: Db, rp: RelyingParty, user: User, challengeId: unknown, response: any, name: unknown) {
  const { challenge, user_id } = takeChallenge(db, challengeId, 'reg');
  if (user_id !== user.id) throw new AccountError('CHALLENGE_EXPIRED', 'Défi invalide.', 400);
  let result;
  try {
    result = await webauthn.verifyRegistrationResponse({
      response, expectedChallenge: challenge, expectedOrigin: rp.origin, expectedRPID: rp.rpID, requireUserVerification: true,
    });
  } catch {
    throw new AccountError('PASSKEY_INVALID', 'Passkey refusée.', 400);
  }
  if (!result.verified) throw new AccountError('PASSKEY_INVALID', 'Passkey refusée.', 400);
  const { credential } = result.registrationInfo;
  const label = typeof name === 'string' && name.trim() ? name.trim().slice(0, 40) : 'Passkey';
  db.prepare('INSERT INTO passkeys (id, user_id, public_key, counter, transports, name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(credential.id, user.id, credential.publicKey, credential.counter, JSON.stringify(credential.transports ?? []), label, Date.now());
}

/** Connexion « découvrable » : pas de liste d'identifiants envoyée, le navigateur propose ses passkeys. */
export async function authenticationOptions(db: Db, rp: RelyingParty, userId: number | null = null) {
  const allow = userId === null ? undefined
    : (db.prepare('SELECT id, transports FROM passkeys WHERE user_id = ?').all(userId) as { id: string; transports: string | null }[])
      .map((p) => ({ id: p.id, transports: p.transports ? JSON.parse(p.transports) : undefined }));
  const options = await webauthn.generateAuthenticationOptions({ rpID: rp.rpID, userVerification: 'required', allowCredentials: allow });
  return { challengeId: saveChallenge(db, options.challenge, 'auth', userId), options };
}

/** Vérifie une assertion ; retourne le compte propriétaire de la passkey. */
export async function verifyAuthentication(db: Db, rp: RelyingParty, challengeId: unknown, response: any): Promise<User> {
  const { challenge, user_id } = takeChallenge(db, challengeId, 'auth');
  const fail = new AccountError('PASSKEY_INVALID', 'Passkey refusée.', 401);
  const row = typeof response?.id === 'string'
    ? db.prepare('SELECT * FROM passkeys WHERE id = ?').get(response.id) as PasskeyRow | undefined
    : undefined;
  if (!row || (user_id !== null && row.user_id !== user_id)) throw fail;
  let result;
  try {
    result = await webauthn.verifyAuthenticationResponse({
      response, expectedChallenge: challenge, expectedOrigin: rp.origin, expectedRPID: rp.rpID, requireUserVerification: true,
      credential: { id: row.id, publicKey: new Uint8Array(row.public_key), counter: row.counter, transports: row.transports ? JSON.parse(row.transports) : undefined },
    });
  } catch {
    throw fail;
  }
  if (!result.verified) throw fail;
  db.prepare('UPDATE passkeys SET counter = ?, last_used_at = ? WHERE id = ?').run(result.authenticationInfo.newCounter, Date.now(), row.id);
  const user = getUser(db, row.user_id);
  if (!user || user.disabled) throw fail;
  return user;
}

export function listPasskeys(db: Db, userId: number) {
  return db.prepare('SELECT id, name, created_at AS createdAt, last_used_at AS lastUsedAt FROM passkeys WHERE user_id = ? ORDER BY created_at').all(userId);
}

/** Jamais la dernière passkey d'un admin tant que Tailscale n'est pas validé ; jamais la dernière méthode de connexion. */
export function deletePasskey(db: Db, user: User, id: unknown): void {
  const row = typeof id === 'string' ? db.prepare('SELECT id FROM passkeys WHERE id = ? AND user_id = ?').get(id, user.id) : undefined;
  if (!row) throw new AccountError('NOT_FOUND', 'Passkey introuvable.', 404);
  const count = (db.prepare('SELECT COUNT(*) AS n FROM passkeys WHERE user_id = ?').get(user.id) as { n: number }).n;
  // Même depuis Tailscale : un admin sans passkey pourrait s'en faire enregistrer une par une simple session.
  if (user.role === 'admin' && count <= 1) {
    throw new AccountError('LAST_PASSKEY', 'Impossible de révoquer la dernière passkey d\'un admin : ajoutez-en d\'abord une autre.', 409);
  }
  if (countLoginMethods(db, user.id) <= 1) {
    throw new AccountError('LAST_METHOD', 'Impossible de retirer votre dernière méthode de connexion.', 409);
  }
  db.prepare('DELETE FROM passkeys WHERE id = ?').run(id as string);
}
