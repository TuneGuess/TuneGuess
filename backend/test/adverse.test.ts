import { test, mock, after } from 'node:test';
import assert from 'node:assert/strict';
import { AddressInfo } from 'node:net';
import express from 'express';
import { DatabaseSync } from 'node:sqlite';
import { migrate, Db } from '../src/comptes/db';
import { setEncryptionKeyForTests } from '../src/comptes/secrets';
import { AccountError, createUser, deleteUser, linkExternal, loginWithExternal, setRole, setUsername } from '../src/comptes/accounts';
import { createSession, elevateSession } from '../src/comptes/sessions';
import { checkAdminEnrollment, consumeBootstrapCode, ENROLL_CODE_TTL_MS, ensureBootstrap, RESET_CODE_TTL_MS } from '../src/comptes/bootstrap';
import { webauthn } from '../src/comptes/passkeys';
import { createAccountRouter, resetRateLimits } from '../src/comptes/routes';
import { setConfig } from '../src/comptes/config';
import { loadAccountTracks, trackProviders } from '../src/comptes/sources';
import { sha256 } from '../src/comptes/secrets';
import { Room } from '../src/Room';
import { Player } from '../src/Player';
import { io, server } from '../src/server';
import { Client, closeAll } from './socketClient';

// Défauts trouvés par la revue adverse de feat/comptes : un test par correctif.
setEncryptionKeyForTests('cle-de-test-suffisamment-longue-pour-aes-256');
const ORIGIN = 'http://localhost:5173';
const newDb = (): Db => {
  const d = new DatabaseSync(':memory:');
  d.exec('PRAGMA foreign_keys = ON');
  migrate(d);
  return d;
};
const addPasskey = (db: Db, id: string, userId: number) =>
  db.prepare("INSERT INTO passkeys (id, user_id, public_key, counter, created_at) VALUES (?, ?, x'01', 0, 0)").run(id, userId);

async function app(db: Db) {
  const a = express();
  const { router, requireAdmin } = createAccountRouter(db);
  a.use(router);
  a.get('/api/admin/test', requireAdmin, (_q, r) => void r.json({ ok: true }));
  const s = a.listen(0);
  await new Promise((r) => s.once('listening', r));
  const base = 'http://127.0.0.1:' + (s.address() as AddressInfo).port;
  const call = async (cookie: string, method: string, path: string, body?: unknown) => {
    const res = await fetch(base + path, {
      method,
      headers: { origin: ORIGIN, 'content-type': 'application/json', cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  return { call, close: () => s.close() };
}

function googleAdmin(db: Db) {
  const { user } = loginWithExternal(db, { provider: 'google', subject: 'g1', label: 'x', displayName: 'Admin', accessToken: null });
  setUsername(db, user.id, 'boss');
  db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(user.id);
  return user;
}

test('A. admin non élevé : ni ajout ni suppression de passkey, donc pas d\'admin par une passkey fabriquée', async () => {
  const db = newDb();
  const user = googleAdmin(db);
  addPasskey(db, 'legit', user.id);
  const a = await app(db);
  const token = createSession(db, user.id); // session Google (ou cookie volé), non élevée
  const stolen = `tg_session=${token}`;
  assert.equal((await a.call(stolen, 'GET', '/api/admin/test')).json.code, 'PASSKEY_REQUIRED');

  const reg = mock.method(webauthn, 'verifyRegistrationResponse', async () => ({
    verified: true, registrationInfo: { credential: { id: 'attacker', publicKey: new Uint8Array([9]), counter: 0, transports: [] } },
  }));
  const o = await a.call(stolen, 'POST', '/api/compte/passkeys/options', {});
  assert.equal(o.status, 403);
  assert.equal(o.json.code, 'PASSKEY_REQUIRED');
  const r = await a.call(stolen, 'POST', '/api/compte/passkeys', { challengeId: 'x', response: { id: 'attacker' } });
  assert.equal(r.status, 403);
  const del = await a.call(stolen, 'DELETE', '/api/compte/passkeys/legit');
  assert.equal(del.status, 403);
  assert.deepEqual(db.prepare('SELECT id FROM passkeys').all().map((p: any) => p.id), ['legit']);

  // Élevée (passkey existante confirmée) : l'ajout redevient possible.
  elevateSession(db, sha256(token), false);
  assert.equal((await a.call(stolen, 'POST', '/api/compte/passkeys/options', {})).status, 200);
  reg.mock.restore();
  a.close();
});

test('A. amorçage : la première passkey reste enregistrable ; admin sans passkey : aucun ajout sans élévation', async () => {
  const db = newDb();
  const code = ensureBootstrap(db, { log: () => {} })!;
  const boot = consumeBootstrapCode(db, code)!;
  const a = await app(db);
  assert.equal((await a.call(`tg_session=${createSession(db, boot.id)}`, 'POST', '/api/compte/passkeys/options', {})).status, 200);
  const nokey = googleAdmin(db); // admin hérité, sans passkey : plus d'exception
  assert.equal((await a.call(`tg_session=${createSession(db, nokey.id)}`, 'POST', '/api/compte/passkeys/options', {})).status, 403);
  a.close();
});

test('C. code de reset : invalide après un redémarrage sans RESET, et expiré au bout d\'une heure', () => {
  const db = newDb();
  const admin = createUser(db, 'A', { role: 'admin' });
  addPasskey(db, 'k', admin.id);
  const code = ensureBootstrap(db, { reset: true, log: () => {} })!;
  assert.equal(ensureBootstrap(db, { log: () => {} }), null);
  assert.equal(consumeBootstrapCode(db, code), null, 'empreinte effacée au démarrage');

  const code2 = ensureBootstrap(db, { reset: true, log: () => {} })!;
  assert.equal(consumeBootstrapCode(db, code2, Date.now() + RESET_CODE_TTL_MS + 1), null, 'expiré');
  assert.ok(consumeBootstrapCode(db, code2, Date.now() + 1000), 'valable dans l\'heure');

  // Premier amorçage (aucun admin) : le code ne périme pas, il survit au redémarrage.
  const fresh = newDb();
  const first = ensureBootstrap(fresh, { log: () => {} })!;
  assert.equal(ensureBootstrap(fresh, { log: () => {} }), null);
  assert.ok(consumeBootstrapCode(fresh, first, Date.now() + 10 * RESET_CODE_TTL_MS));
});

test('4. propriétaire de la piste : réponse refusée, pas attendu pour clore la manche', () => {
  const room = new Room('r', 'R', 'p1');
  room.players.push(new Player('p1', 'Un', 0, true), new Player('p2', 'Deux', 0, false));
  room.currentQuestion = { track: { id: 't', provider: 'lastfm', name: 'n', artists: 'a' } as any, playerId: 'p2', mediaKey: null };
  room.roundStartedAtMs = 1000;
  room.roundEndsAtMs = 11000;
  assert.throws(() => room.submitAnswer('p2', 'p2', 1100), /ta piste/);
  assert.equal(room.players[1].score, 0);
  assert.equal(room.getRoundState(1200).totalPlayers, 1);
  room.submitAnswer('p1', 'p2', 1200);
  assert.equal(room.getRoundState(1300).allAnswered, true);
});

test('5. YouTube désactivé dans l\'admin : la source déjà liée n\'est plus lue', async () => {
  const db = newDb();
  setConfig(db, 'googleClientId', 'id');
  setConfig(db, 'googleClientSecret', 'secret');
  const u = createUser(db, 'U');
  linkExternal(db, u.id, { provider: 'youtube', subject: 'g1', label: 'y', displayName: 'y', accessToken: 'tok', refreshToken: 'rt', expiresAt: Date.now() + 3600e3 });
  const yt = mock.method(trackProviders.youtube, 'getUserTopTracks', async () => [{ id: 'abcdefghijk', provider: 'youtube', name: 'n', artists: 'a' }]);
  assert.equal((await loadAccountTracks(db, u.id)).tracks.length, 1);
  setConfig(db, 'youtubeEnabled', 'false');
  const res = await loadAccountTracks(db, u.id);
  assert.equal(res.tracks.length, 0);
  assert.equal(yt.mock.callCount(), 1, 'pas d\'appel YouTube une fois désactivé');
  yt.mock.restore();
});

test('7. dernier vrai admin : un amorçage en cours ou un admin sans passkey ne compte pas', () => {
  const db = newDb();
  const real = createUser(db, 'Vrai', { role: 'admin' });
  addPasskey(db, 'k1', real.id);
  createUser(db, 'Amorçage', { role: 'admin', bootstrap: true });
  const nokey = createUser(db, 'SansPasskey', { role: 'admin' });
  const isLast = (e: unknown) => (e as AccountError).code === 'LAST_ADMIN';
  assert.throws(() => deleteUser(db, real.id), isLast);
  assert.throws(() => setRole(db, real.id, 'user'), isLast);
  setRole(db, nokey.id, 'user'); // pas un vrai admin : rétrogradable
  deleteUser(db, nokey.id);
});

test('6. socket.io : Origin d\'un autre site refusée, cookie inutilisable', async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const ws = `ws://127.0.0.1:${(server.address() as AddressInfo).port}/socket.io/?EIO=4&transport=websocket`;
  await assert.rejects(Client.connect(ws, { origin: 'https://site-frere.example' }));
  const ok = await Client.connect(ws, { origin: ORIGIN });
  assert.ok(ok.id);
});

after(() => {
  closeAll();
  io.close();
  server.close();
});


// --- Contre-vérification (tests E et F de adverse2.test.ts, plus completeAdmins) ---
async function proxiedApp(db: Db) {
  const a = express();
  a.set('trust proxy', true);
  const { router, requireAdmin } = createAccountRouter(db);
  a.use(router);
  a.get('/api/admin/test', requireAdmin, (_q, r) => void r.json({ ok: true }));
  const s = a.listen(0);
  await new Promise((r) => s.once('listening', r));
  const base = 'http://127.0.0.1:' + (s.address() as AddressInfo).port;
  const call = async (cookie: string, method: string, path: string, body?: unknown, ip = '203.0.113.9') => {
    const res = await fetch(base + path, {
      method,
      headers: { origin: ORIGIN, 'content-type': 'application/json', cookie, 'x-forwarded-for': ip },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const sc = res.headers.getSetCookie().map((c) => c.split(';')[0]).find((c) => c.startsWith('tg_session=') && c.length > 12);
    return { status: res.status, json: await res.json().catch(() => null), cookie: sc };
  };
  return { call, close: () => s.close() };
}
type ProxiedApp = Awaited<ReturnType<typeof proxiedApp>>;
const google = (db: Db, sub: string, name: string) => {
  const { user } = loginWithExternal(db, { provider: 'google', subject: sub, label: 'x', displayName: name, accessToken: null });
  setUsername(db, user.id, name);
  return user;
};
const realAdmin = (db: Db, sub: string, name: string) => {
  const u = google(db, sub, name);
  db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(u.id);
  addPasskey(db, `pk-${name}`, u.id);
  return u;
};
/** Passkey fabriquée par l'attaquant (WebAuthn simulé), puis connexion avec : renvoie le statut de /api/admin/test. */
async function takeover(a: ProxiedApp, cookie: string, id: string) {
  const reg = mock.method(webauthn, 'verifyRegistrationResponse', async () => ({
    verified: true, registrationInfo: { credential: { id, publicKey: new Uint8Array([9]), counter: 0, transports: [] } },
  }));
  const o = await a.call(cookie, 'POST', '/api/compte/passkeys/options', {});
  const r = await a.call(cookie, 'POST', '/api/compte/passkeys', { challengeId: o.json?.challengeId, response: { id } });
  reg.mock.restore();
  if (r.status !== 200) return { registered: r.status, admin: null as number | null };
  const auth = mock.method(webauthn, 'verifyAuthenticationResponse', async () => ({ verified: true, authenticationInfo: { newCounter: 1 } }));
  const o2 = await a.call('', 'POST', '/api/passkey/options', {});
  const l = await a.call('', 'POST', '/api/passkey/connexion', { challengeId: o2.json.challengeId, response: { id } });
  auth.mock.restore();
  return { registered: 200, admin: (await a.call(l.cookie!, 'GET', '/api/admin/test')).status };
}

test('E. admin Tailscale validé : jamais sa dernière passkey supprimée, donc pas de passkey fabriquée ensuite', async () => {
  process.env.TRUST_PROXY = '1';
  resetRateLimits();
  try {
    const db = newDb();
    const u = realAdmin(db, 'g2', 'chef');
    realAdmin(db, 'g9', 'autre'); // un 2e vrai admin : le refus ne vient pas de la règle du dernier admin
    db.prepare('UPDATE users SET tailscale_validated_at = ? WHERE id = ?').run(Date.now(), u.id);
    const a = await proxiedApp(db);
    const s = `tg_session=${createSession(db, u.id)}`;
    assert.equal((await a.call(s, 'GET', '/api/admin/test', undefined, '100.64.0.7')).status, 200, 'accès admin depuis Tailscale');
    const del = await a.call(s, 'DELETE', '/api/compte/passkeys/pk-chef', undefined, '100.64.0.7');
    assert.equal(del.status, 409);
    assert.equal(del.json.code, 'LAST_PASSKEY');
    assert.deepEqual(await takeover(a, s, 'att2'), { registered: 403, admin: null }, 'hors Tailscale, session non élevée');
    // Remplacer : ajouter d'abord (accès admin), puis la première peut partir.
    const reg = mock.method(webauthn, 'verifyRegistrationResponse', async () => ({
      verified: true, registrationInfo: { credential: { id: 'neuve', publicKey: new Uint8Array([9]), counter: 0, transports: [] } },
    }));
    const o = await a.call(s, 'POST', '/api/compte/passkeys/options', {}, '100.64.0.7');
    assert.equal((await a.call(s, 'POST', '/api/compte/passkeys', { challengeId: o.json.challengeId, response: { id: 'neuve' } }, '100.64.0.7')).status, 200);
    reg.mock.restore();
    assert.equal((await a.call(s, 'DELETE', '/api/compte/passkeys/pk-chef', undefined, '100.64.0.7')).status, 200);
    a.close();
  } finally {
    delete process.env.TRUST_PROXY;
  }
});

test('F. promotion : aucun droit admin avant l\'enrôlement (code unique 1 h + passkey)', async () => {
  resetRateLimits();
  const db = newDb();
  const boss = realAdmin(db, 'g3', 'boss2');
  const u = google(db, 'g4', 'promu');
  assert.throws(() => setRole(db, u.id, 'admin'), (e: AccountError) => e.code === 'ENROLLMENT_REQUIRED', 'pas de rôle admin sans passkey');
  const a = await proxiedApp(db);
  const bs = `tg_session=${createSession(db, boss.id)}`;
  elevateSession(db, sha256(bs.slice('tg_session='.length)), false);
  const promo = await a.call(bs, 'PATCH', `/api/admin/users/${u.id}`, { role: 'admin' });
  assert.equal(promo.status, 200);
  assert.equal(promo.json.user.role, 'user', 'la promotion ne donne rien tout de suite');
  const { code } = promo.json.enrollment;
  assert.ok(code && promo.json.enrollment.expiresAt > Date.now());
  assert.ok(!JSON.stringify((await a.call(bs, 'GET', '/api/admin/users')).json).includes(code), 'code affiché une seule fois');

  const s = `tg_session=${createSession(db, u.id)}`;
  assert.equal((await a.call(s, 'GET', '/api/admin/test')).status, 403, 'session Google du promu : pas d\'admin');
  assert.equal((await takeover(a, s, 'att3')).admin, 403, 'une passkey ordinaire ne donne pas l\'admin');
  assert.equal((await a.call(s, 'POST', '/api/compte/enrolement-admin/options', { code: 'faux' })).status, 401);
  // Code expiré : refusé.
  assert.equal(
    checkAdminEnrollment(db, u.id, code, Date.now() + ENROLL_CODE_TTL_MS + 1), false);

  const reg = mock.method(webauthn, 'verifyRegistrationResponse', async () => ({
    verified: true, registrationInfo: { credential: { id: 'enrol', publicKey: new Uint8Array([9]), counter: 0, transports: [] } },
  }));
  const o = await a.call(s, 'POST', '/api/compte/enrolement-admin/options', { code });
  assert.equal(o.status, 200);
  const done = await a.call(s, 'POST', '/api/compte/enrolement-admin', { code, challengeId: o.json.challengeId, response: { id: 'enrol' } });
  assert.equal(done.status, 200);
  assert.equal(done.json.user.role, 'admin');
  assert.equal((await a.call(s, 'GET', '/api/admin/test')).status, 200, 'admin après enrôlement (session élevée)');
  const again = await a.call(s, 'POST', '/api/compte/enrolement-admin/options', { code });
  assert.equal(again.status, 401, 'code à usage unique');
  reg.mock.restore();

  // Rétrograder annule un enrôlement en attente.
  const v = google(db, 'g5', 'autre2');
  const p2 = await a.call(bs, 'PATCH', `/api/admin/users/${v.id}`, { role: 'admin' });
  await a.call(bs, 'PATCH', `/api/admin/users/${v.id}`, { role: 'user' });
  const sv = `tg_session=${createSession(db, v.id)}`;
  assert.equal((await a.call(sv, 'POST', '/api/compte/enrolement-admin/options', { code: p2.json.enrollment.code })).status, 401);

  // Désactiver puis réactiver annule aussi l'enrôlement en attente.
  const w = google(db, 'g6', 'autre3');
  const p3 = await a.call(bs, 'PATCH', `/api/admin/users/${w.id}`, { role: 'admin' });
  assert.equal((await a.call(bs, 'PATCH', `/api/admin/users/${w.id}`, { disabled: true })).status, 200);
  assert.equal((await a.call(bs, 'PATCH', `/api/admin/users/${w.id}`, { disabled: false })).status, 200);
  assert.equal(checkAdminEnrollment(db, w.id, p3.json.enrollment.code), false, 'code mort après désactivation');
  a.close();
});

test('3. completeAdmins : un admin promu sans passkey ne bloque ni le code d\'amorçage ni un reset en attente', () => {
  const db = newDb();
  const half = createUser(db, 'Moitié', { role: 'admin' }); // à moitié enrôlé : pas de passkey
  assert.ok(ensureBootstrap(db, { log: () => {} }), 'code d\'amorçage généré');
  const reset = ensureBootstrap(db, { reset: true, log: () => {} })!;
  assert.equal(ensureBootstrap(db, { log: () => {} }), null, 'code existant, pas de nouveau');
  assert.ok(consumeBootstrapCode(db, reset), 'reset en attente pas effacé');
  assert.equal(half.role, 'admin');
});
