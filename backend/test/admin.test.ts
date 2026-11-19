import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { AddressInfo } from 'net';
import { db, io, server } from '../src/server';
import { createUser, setUsername } from '../src/comptes/accounts';
import { createSession, elevateSession } from '../src/comptes/sessions';
import { sha256 } from '../src/comptes/secrets';

// L'admin des salons n'a plus de mot de passe : compte admin + passkey confirmée (ou Tailscale validé).
let base = '';
before(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => {
  io.close();
  server.close();
});

function session(role: 'user' | 'admin', name: string, elevated = false) {
  const user = createUser(db, name, { role });
  setUsername(db, user.id, name.toLowerCase());
  const token = createSession(db, user.id);
  if (elevated) elevateSession(db, sha256(token), false);
  return `tg_session=${token}`;
}

const salons = (cookie?: string, init: RequestInit = {}) =>
  fetch(`${base}/api/admin/salons${init.method === 'DELETE' ? '/inconnu' : ''}`, { ...init, headers: { ...(cookie ? { cookie } : {}), ...(init.headers as any) } });

test('admin des salons : connexion, rôle et passkey exigés', async () => {
  assert.equal((await salons()).status, 401);
  assert.equal((await salons(session('user', 'Joueur'))).status, 403);
  const notElevated = await salons(session('admin', 'Chef'));
  assert.equal(notElevated.status, 403);
  assert.equal((await notElevated.json()).code, 'PASSKEY_REQUIRED');
  const ok = await salons(session('admin', 'Cheffe', true));
  assert.equal(ok.status, 200);
  assert.ok(Array.isArray(await ok.json()));
});

test('admin des salons : écriture refusée sans la bonne origine', async () => {
  const cookie = session('admin', 'Gerant', true);
  assert.equal((await salons(cookie, { method: 'DELETE' })).status, 403, 'pas d\'Origin : CSRF');
  assert.equal((await salons(cookie, { method: 'DELETE', headers: { origin: 'https://evil.example' } })).status, 403);
  assert.equal((await salons(cookie, { method: 'DELETE', headers: { origin: 'http://localhost:5173' } })).status, 404, 'origine du site : salon inconnu');
});

test('ancienne route /admin/rooms : plus servie par le backend', async () => {
  assert.equal((await fetch(`${base}/admin/rooms`)).status, 404);
});
