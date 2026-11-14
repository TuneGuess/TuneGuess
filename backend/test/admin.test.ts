import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { AddressInfo } from 'net';
import { randomUUID } from 'crypto';
import { adminAuth, app, io, server } from '../src/server';

// Mot de passe tiré au hasard à chaque exécution.
const PASSWORD = randomUUID();
let base = '';
before(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => {
  io.close();
  server.close();
});

const get = (password?: string) =>
  fetch(`${base}/admin/rooms`, { headers: password ? { Authorization: `Bearer ${password}` } : {} });

test('admin désactivé sans ADMIN_PASSWORD (pas de mot de passe par défaut)', async () => {
  delete process.env.ADMIN_PASSWORD;
  assert.equal((await get('admin')).status, 503);
});

test('admin : mauvais mot de passe refusé, bon accepté', async () => {
  process.env.ADMIN_PASSWORD = PASSWORD;
  assert.equal((await get()).status, 401);
  assert.equal((await get('wrong')).status, 401);
  assert.equal((await get(PASSWORD)).status, 200);
});

test('admin : en-tête Host forgé depuis une adresse publique refusé', () => {
  process.env.ADMIN_PASSWORD = PASSWORD;
  let status = 0;
  let nextCalled = false;
  const req = {
    socket: { remoteAddress: '203.0.113.7' },
    headers: { host: 'localhost', authorization: `Bearer ${PASSWORD}`, 'x-forwarded-for': '127.0.0.1' },
    hostname: 'localhost',
    ip: '203.0.113.7',
  } as any;
  const res = { status: (s: number) => ((status = s), res), json: () => res } as any;
  adminAuth(req, res, () => (nextCalled = true));
  assert.equal(status, 403);
  assert.equal(nextCalled, false);
});

test('admin : X-Forwarded-For ignoré sans TRUST_PROXY, pris en compte avec', async () => {
  process.env.ADMIN_PASSWORD = PASSWORD;
  const forwarded = () =>
    fetch(`${base}/admin/rooms`, { headers: { Authorization: `Bearer ${PASSWORD}`, 'X-Forwarded-For': '203.0.113.7' } });
  assert.equal((await forwarded()).status, 200, 'sans relais de confiance : IP du socket (loopback)');
  app.set('trust proxy', 'loopback');
  try {
    assert.equal((await forwarded()).status, 403, 'relais loopback de confiance : IP publique transmise');
  } finally {
    app.set('trust proxy', false);
  }
});
