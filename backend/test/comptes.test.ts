import { after, before, beforeEach, describe, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import express from 'express';
import { DatabaseSync } from 'node:sqlite';
import { migrate, Db } from '../src/comptes/db';
import { decrypt, encrypt, setEncryptionKeyForTests, sha256 } from '../src/comptes/secrets';
import {
  AccountError, createUser, getUser, isUsernameAvailable, linkExternal, loginWithExternal, setRole, setUsername, suggestUsername,
  unlinkExternal, validateUsername,
} from '../src/comptes/accounts';
import { adminAccess, createSession, ELEVATION_TTL_MS, resolveSession } from '../src/comptes/sessions';
import { ensureBootstrap } from '../src/comptes/bootstrap';
import { lastfmSignature, oauthHttp } from '../src/comptes/oauth';
import { webauthn } from '../src/comptes/passkeys';
import { createAccountRouter, resetRateLimits } from '../src/comptes/routes';
import { setConfig } from '../src/comptes/config';
import { freshTokens, loadAccountTracks } from '../src/comptes/sources';

setEncryptionKeyForTests('cle-de-test-suffisamment-longue-pour-aes-256');
const ORIGIN = 'http://localhost:5173';

function newDb(): Db {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  migrate(db);
  return db;
}

/** Petit client HTTP avec cookie, contre un vrai serveur express sur un port libre. */
async function startApp(db: Db, opts: { trustProxy?: boolean } = {}) {
  const app = express();
  if (opts.trustProxy) app.set('trust proxy', true);
  const { router, requireAdmin } = createAccountRouter(db);
  app.use(router);
  app.get('/api/admin/test', requireAdmin, (_req, res) => res.json({ ok: true }));
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const client = () => {
    let cookie = '';
    const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
      const res = await fetch(base + path, {
        method, redirect: 'manual',
        headers: { origin: ORIGIN, 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      for (const c of res.headers.getSetCookie()) {
        const [pair] = c.split(';');
        const [name, value] = pair.split('=');
        const jar = new Map(cookie ? cookie.split('; ').map((x) => x.split('=') as [string, string]) : []);
        if (value) jar.set(name, value); else jar.delete(name);
        cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
      }
      const text = await res.text();
      let json: any = null;
      try { json = JSON.parse(text); } catch { /* redirection */ }
      return { status: res.status, json, location: res.headers.get('location'), raw: text };
    };
    return { call, setCookie: (c: string) => { cookie = c; }, getCookie: () => cookie };
  };
  return { base, client, close: () => new Promise((r) => server.close(r)) };
}

const googleProfile = (sub: string, name = 'Alice Martin') => ({
  provider: 'google' as const, subject: sub, label: `${sub}@example.com`, displayName: name, accessToken: null, meta: { email: `${sub}@example.com` },
});

describe('chiffrement des jetons', () => {
  test('aller-retour AES-256-GCM, falsification détectée', () => {
    const sealed = encrypt('jeton-secret');
    assert.notEqual(sealed, 'jeton-secret');
    assert.equal(decrypt(sealed), 'jeton-secret');
    // Le caractère remplacé est toujours différent de l'original (avant : 1 chance sur 64 de ne rien changer).
    const tampered = sealed.slice(0, -2) + (sealed.at(-2) === 'A' ? 'B' : 'A') + sealed.slice(-1);
    assert.notEqual(tampered, sealed);
    assert.throws(() => decrypt(tampered));
  });
});

describe('identifiant', () => {
  let db: Db;
  beforeEach(() => { db = newDb(); });

  test('format invalide refusé', () => {
    for (const bad of ['ab', 'a'.repeat(21), 'avec espace', 'émile', 'tiret-non', '']) {
      assert.throws(() => validateUsername(bad), (e: AccountError) => e.code === 'USERNAME_INVALID', bad);
    }
    assert.equal(validateUsername('Alice_01.x'), 'alice_01.x');
  });

  test('nom réservé refusé', () => {
    for (const r of ['admin', 'Root', 'tuneguess', 'support', 'moderateur']) {
      assert.throws(() => validateUsername(r), (e: AccountError) => e.code === 'USERNAME_RESERVED', r);
    }
  });

  test('doublon insensible à la casse refusé, changement libère l\'ancien', () => {
    const a = createUser(db, 'A');
    const b = createUser(db, 'B');
    setUsername(db, a.id, 'Alice');
    assert.throws(() => setUsername(db, b.id, 'ALICE'), (e: AccountError) => e.code === 'USERNAME_TAKEN');
    setUsername(db, a.id, 'alice2');
    assert.equal(isUsernameAvailable(db, 'alice'), true);
    assert.equal(setUsername(db, b.id, 'alice').username, 'alice');
  });

  test('suggestion dérivée du nom, suffixe si pris', () => {
    const a = createUser(db, 'A');
    assert.equal(suggestUsername(db, 'Élodie Durand'), 'elodie_durand');
    setUsername(db, a.id, 'elodie_durand');
    assert.equal(suggestUsername(db, 'Élodie Durand'), 'elodie_durand2');
    assert.match(suggestUsername(db, '!!'), /^joueur/);
  });
});

describe('comptes Google et sources', () => {
  let db: Db;
  beforeEach(() => { db = newDb(); });

  test('Google crée le compte, retrouve le même ensuite ; la liaison Google ne se retire pas', () => {
    const first = loginWithExternal(db, googleProfile('g1'));
    assert.equal(first.created, true);
    assert.equal(first.user.username, null);
    const again = loginWithExternal(db, googleProfile('g1'));
    assert.equal(again.created, false);
    assert.equal(again.user.id, first.user.id);
    assert.throws(() => unlinkExternal(db, first.user.id, 'google'), (e: AccountError) => e.code === 'LAST_METHOD');
  });

  test('Last.fm et Jellyfin ne sont pas des méthodes de connexion et se délient librement', () => {
    assert.throws(() => loginWithExternal(db, { provider: 'lastfm', subject: 'x', label: 'x', displayName: 'x', accessToken: 'k' }),
      (e: AccountError) => e.code === 'NOT_A_LOGIN_METHOD');
    const { user } = loginWithExternal(db, googleProfile('g1'));
    linkExternal(db, user.id, { provider: 'lastfm', subject: 'rj', label: 'rj', displayName: 'rj', accessToken: 'k' });
    linkExternal(db, user.id, { provider: 'jellyfin', subject: 's:u', label: 'j', displayName: 'j', accessToken: 't', meta: { serverUrl: 'http://x' } });
    assert.equal(unlinkExternal(db, user.id, 'lastfm').accessToken, 'k');
    unlinkExternal(db, user.id, 'jellyfin');
  });

  test('identité déjà liée à un autre compte refusée, sans fusion', () => {
    const a = loginWithExternal(db, googleProfile('g1')).user;
    const b = loginWithExternal(db, googleProfile('g2')).user;
    linkExternal(db, a.id, { provider: 'lastfm', subject: 'rj', label: 'rj', displayName: 'rj', accessToken: 'k' });
    assert.throws(() => linkExternal(db, b.id, { provider: 'lastfm', subject: 'rj', label: 'rj', displayName: 'rj', accessToken: 'k' }),
      (e: AccountError) => e.code === 'IDENTITY_TAKEN');
    assert.throws(() => linkExternal(db, a.id, googleProfile('g2')), (e: AccountError) => e.code === 'IDENTITY_TAKEN');
  });

  test('jetons chiffrés en base', () => {
    const { user } = loginWithExternal(db, googleProfile('g1'));
    linkExternal(db, user.id, { provider: 'youtube', subject: 'g1', label: 'y', displayName: 'y', accessToken: 'ya29.secret', refreshToken: 'rt-secret', expiresAt: Date.now() + 3600e3 });
    const row = db.prepare("SELECT access_enc, refresh_enc FROM identities WHERE provider = 'youtube'").get() as any;
    assert.ok(!String(row.access_enc).includes('ya29') && !String(row.refresh_enc).includes('rt-secret'));
  });

  test('YouTube : rafraîchissement automatique d\'un jeton expiré, échec = reconnexion demandée', async () => {
    const { user } = loginWithExternal(db, googleProfile('g1'));
    linkExternal(db, user.id, { provider: 'youtube', subject: 'g1', label: 'y', displayName: 'y', accessToken: 'vieux', refreshToken: 'rt', expiresAt: Date.now() - 1 });
    const post = mock.method(oauthHttp, 'post', async () => ({ data: { access_token: 'neuf', expires_in: 3600 } }));
    const t = await freshTokens(db, user.id, 'youtube');
    assert.equal(t.accessToken, 'neuf');
    assert.equal(t.refreshToken, 'rt', 'refresh token conservé');
    post.mock.mockImplementation(async () => { throw Object.assign(new Error('400'), { response: { status: 400 } }); });
    await assert.rejects(freshTokens(db, user.id, 'youtube', true), (e: AccountError) => e.code === 'RECONNECT_REQUIRED');
    post.mock.restore();
  });
});

describe('Last.fm', () => {
  test('signature api_sig : md5 des paramètres triés + secret', () => {
    // md5("api_keyKmethodauth.getSessiontokenTSECRET")
    assert.equal(lastfmSignature({ method: 'auth.getSession', api_key: 'K', token: 'T', format: 'json' }, 'SECRET'),
      createHash('md5').update('api_keyKmethodauth.getSessiontokenTSECRET').digest('hex'));
  });
});

describe('routes compte (HTTP)', () => {
  let db: Db;
  let app: Awaited<ReturnType<typeof startApp>>;
  before(async () => {
    db = newDb();
    setConfig(db, 'googleClientId', 'gid');
    setConfig(db, 'googleClientSecret', 'gsecret');
    setConfig(db, 'lastfmApiKey', 'lkey');
    setConfig(db, 'lastfmApiSecret', 'lsecret');
    app = await startApp(db);
  });
  after(() => app.close());
  beforeEach(() => resetRateLimits());

  async function googleLogin(sub: string) {
    const c = app.client();
    const start = await c.call('GET', '/auth/compte/google/start');
    assert.equal(start.status, 302);
    const authUrl = new URL(start.location!);
    assert.equal(authUrl.searchParams.get('scope'), 'openid email profile', 'aucun scope sensible à la connexion');
    const state = authUrl.searchParams.get('state')!;
    const get = mock.method(oauthHttp, 'get', async () => ({ data: { sub, name: 'Alice', email: `${sub}@example.com` } }));
    const post = mock.method(oauthHttp, 'post', async () => ({ data: { access_token: 'at', expires_in: 3600 } }));
    const cb = await c.call('GET', `/auth/compte/google/callback?code=abc&state=${state}`);
    get.mock.restore(); post.mock.restore();
    return { c, cb };
  }

  test('connexion Google → étape identifiant obligatoire → compte utilisable', async () => {
    const { c, cb } = await googleLogin('g100');
    assert.equal(cb.status, 302);
    assert.equal(cb.location, `${ORIGIN}/compte/bienvenue`);
    const me = await c.call('GET', '/api/me');
    assert.equal(me.json.user.needsUsername, true);
    assert.equal((await c.call('GET', '/api/compte/connexions')).json.code, 'USERNAME_REQUIRED');
    assert.equal((await c.call('GET', '/api/compte/identifiant/suggestion')).json.username, 'alice');
    assert.equal((await c.call('GET', '/api/compte/identifiant/disponible?u=admin')).json.reason, 'USERNAME_RESERVED');
    assert.equal((await c.call('POST', '/api/compte/identifiant', { username: 'Alice' })).status, 200);
    const conns = await c.call('GET', '/api/compte/connexions');
    assert.equal(conns.status, 200);
    assert.equal(conns.json.providers[0].email, 'g100@example.com'); // scan:ok valeur de test fictive
    const del = await c.call('DELETE', '/api/compte/connexions/google');
    assert.equal(del.json.code, 'LAST_METHOD');
  });

  test('state OAuth absent ou d\'un autre navigateur refusé', async () => {
    const c = app.client();
    const r = await c.call('GET', '/auth/compte/google/callback?code=abc&state=inventé');
    assert.equal(r.location, `${ORIGIN}/connexion?erreur=OAUTH_STATE`);
  });

  test('Last.fm et YouTube ne permettent pas de se connecter', async () => {
    const c = app.client();
    const r = await c.call('GET', '/auth/compte/lastfm/start?intent=login');
    assert.equal(r.location, `${ORIGIN}/connexion?erreur=NOT_A_LOGIN_METHOD`);
  });

  test('YouTube demandé seulement à la liaison (consentement incrémental)', async () => {
    const { c } = await googleLogin('g101');
    await c.call('POST', '/api/compte/identifiant', { username: 'bob' });
    const r = await c.call('GET', '/auth/compte/youtube/start?intent=link');
    const u = new URL(r.location!);
    assert.match(u.searchParams.get('scope')!, /youtube\.readonly/);
    assert.equal(u.searchParams.get('include_granted_scopes'), 'true');
    assert.equal(u.searchParams.get('access_type'), 'offline');
  });

  test('Last.fm par pseudo : lié, aucun jeton renvoyé, déliable', async () => {
    const { c } = await googleLogin('g102');
    await c.call('POST', '/api/compte/identifiant', { username: 'carla' });
    const get = mock.method(oauthHttp, 'get', async () => ({ data: { user: { name: 'CarlaFM' } } }));
    const r = await c.call('POST', '/api/compte/lastfm/pseudo', { username: 'CarlaFM' });
    get.mock.restore();
    assert.equal(r.status, 200);
    assert.ok(r.json.providers.some((p: any) => p.provider === 'lastfm' && p.label === 'CarlaFM'));
    assert.ok(!/access|refresh|token/i.test(Object.keys(r.json.providers[0]).join(',')));
    assert.equal((await c.call('DELETE', '/api/compte/connexions/lastfm')).status, 200);
  });

  test('CSRF : écriture sans la bonne origine refusée', async () => {
    const c = app.client();
    const r = await c.call('POST', '/api/compte/deconnexion', {}, { origin: 'https://evil.example' });
    assert.equal(r.status, 403);
    assert.equal(r.json.code, 'CSRF');
  });

  test('déconnexion supprime la session', async () => {
    const { c } = await googleLogin('g103');
    const token = decodeURIComponent(c.getCookie().match(/tg_session=([^;]+)/)![1]);
    await c.call('POST', '/api/compte/deconnexion', {});
    assert.equal(resolveSession(db, token), null);
    assert.equal((await c.call('GET', '/api/me')).json.user, null);
  });

  test('limite de débit sur la vérification d\'identifiant', async () => {
    const { c } = await googleLogin('g104');
    let last = 0;
    for (let i = 0; i < 61; i++) last = (await c.call('GET', '/api/compte/identifiant/disponible?u=essai' + i)).status;
    assert.equal(last, 429);
  });
});

describe('admin : amorçage, passkey, Tailscale', () => {
  let db: Db;
  let app: Awaited<ReturnType<typeof startApp>>;
  let code: string;
  before(async () => {
    db = newDb();
    code = ensureBootstrap(db, { log: () => {} })!;
    app = await startApp(db, { trustProxy: true });
  });
  after(() => app.close());
  beforeEach(() => resetRateLimits());

  test('code d\'au moins 128 bits, seule l\'empreinte est stockée', () => {
    assert.ok(Buffer.from(code, 'base64url').length >= 16);
    const stored = db.prepare("SELECT value FROM settings WHERE key = '_bootstrap_code'").get() as { value: string };
    assert.equal(stored.value, sha256(code));
  });

  test('mauvais code refusé, avec limite de débit', async () => {
    const c = app.client();
    for (let i = 0; i < 5; i++) assert.equal((await c.call('POST', '/api/admin/amorcage', { code: 'faux' + i })).status, 401);
    assert.equal((await c.call('POST', '/api/admin/amorcage', { code })).status, 429, 'même le bon code est bloqué après 5 essais');
  });

  let admin: ReturnType<typeof app.client>;
  test('bon code accepté une fois, refusé au 2e usage', async () => {
    admin = app.client();
    const ok = await admin.call('POST', '/api/admin/amorcage', { code });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.user.bootstrap, true);
    const again = await app.client().call('POST', '/api/admin/amorcage', { code });
    assert.equal(again.status, 401);
  });

  test('session d\'amorçage limitée à l\'enregistrement d\'une passkey', async () => {
    assert.equal((await admin.call('GET', '/api/admin/test')).json.code, 'BOOTSTRAP');
    assert.equal((await admin.call('GET', '/api/compte/connexions')).json.code, 'BOOTSTRAP_PASSKEY_REQUIRED');
    assert.equal((await admin.call('POST', '/api/compte/identifiant', { username: 'chef' })).json.code, 'BOOTSTRAP_PASSKEY_REQUIRED');
  });

  test('passkey (simulée) enregistrée : amorçage terminé, accès admin', async () => {
    const reg = mock.method(webauthn, 'verifyRegistrationResponse', async () => ({
      verified: true, registrationInfo: { credential: { id: 'cred-1', publicKey: new Uint8Array([1, 2, 3]), counter: 0, transports: ['internal'] } },
    }));
    const opts = await admin.call('POST', '/api/compte/passkeys/options', {});
    assert.equal(opts.status, 200);
    const r = await admin.call('POST', '/api/compte/passkeys', { challengeId: opts.json.challengeId, response: { id: 'cred-1' }, name: 'PC' });
    reg.mock.restore();
    assert.equal(r.status, 200);
    assert.equal(r.json.user.bootstrap, false);
    await admin.call('POST', '/api/compte/identifiant', { username: 'chef' });
    assert.equal((await admin.call('GET', '/api/admin/test')).status, 200);
  });

  test('hors Tailscale sans assertion fraîche : refusé ; avec passkey : accepté', async () => {
    const user = getUser(db, 1)!;
    const fresh = app.client();
    fresh.setCookie(`tg_session=${createSession(db, user.id)}`);
    assert.equal((await fresh.call('GET', '/api/admin/test')).json.code, 'PASSKEY_REQUIRED');
    const auth = mock.method(webauthn, 'verifyAuthenticationResponse', async () => ({ verified: true, authenticationInfo: { newCounter: 1 } }));
    const opts = await fresh.call('POST', '/api/compte/elevation/options', {});
    const r = await fresh.call('POST', '/api/compte/elevation', { challengeId: opts.json.challengeId, response: { id: 'cred-1' } });
    auth.mock.restore();
    assert.equal(r.status, 200);
    assert.equal((await fresh.call('GET', '/api/admin/test')).status, 200);
  });

  test('connexion par passkey (simulée) : session élevée', async () => {
    const auth = mock.method(webauthn, 'verifyAuthenticationResponse', async () => ({ verified: true, authenticationInfo: { newCounter: 2 } }));
    const c = app.client();
    const opts = await c.call('POST', '/api/passkey/options', {});
    const r = await c.call('POST', '/api/passkey/connexion', { challengeId: opts.json.challengeId, response: { id: 'cred-1' } });
    auth.mock.restore();
    assert.equal(r.status, 200);
    assert.equal((await c.call('GET', '/api/admin/test')).status, 200);
  });

  test('Tailscale validé : accès sans passkey depuis une IP Tailscale, plus hors Tailscale', async () => {
    process.env.TRUST_PROXY = '1';
    try {
      const ts = { 'x-forwarded-for': '100.101.102.103' }; // scan:ok valeur de test fictive
      const v = await admin.call('POST', '/api/admin/tailscale/valider', {}, ts);
      assert.equal(v.status, 200);
      const plain = app.client();
      plain.setCookie(`tg_session=${createSession(db, 1)}`);
      assert.equal((await plain.call('GET', '/api/admin/test', undefined, ts)).status, 200, 'IP Tailscale + Tailscale validé');
      assert.equal((await plain.call('GET', '/api/admin/test', undefined, { 'x-forwarded-for': '203.0.113.9' })).json.code, 'PASSKEY_REQUIRED');
    } finally {
      delete process.env.TRUST_PROXY;
    }
  });

  test('X-Forwarded-For forgé ignoré sans TRUST_PROXY', async () => {
    const plain = app.client();
    plain.setCookie(`tg_session=${createSession(db, 1)}`);
    const r = await plain.call('GET', '/api/admin/test', undefined, { 'x-forwarded-for': '100.101.102.103' }); // scan:ok adresse de test fictive
    assert.equal(r.json.code, 'PASSKEY_REQUIRED');
  });

  test('élévation perdue en sortant de Tailscale, expirée après 12 h', () => {
    const user = { ...getUser(db, 1)!, tailscale_validated_at: null };
    const now = Date.now();
    const session = { elevated_at: now, elevated_tailscale: 1 } as any;
    assert.equal(adminAccess({ user, session }, '100.64.0.1', now), 'ok');
    assert.equal(adminAccess({ user, session }, '203.0.113.9', now), 'passkey_required');
    const out = { elevated_at: now, elevated_tailscale: 0 } as any;
    assert.equal(adminAccess({ user, session: out }, '203.0.113.9', now + ELEVATION_TTL_MS + 1), 'passkey_required');
  });

  test('le dernier admin ne peut pas être rétrogradé', () => {
    assert.throws(() => setRole(db, 1, 'user'), (e: AccountError) => e.code === 'LAST_ADMIN');
  });

  test('ADMIN_BOOTSTRAP_RESET régénère un code ; sans reset, rien si un admin existe', () => {
    assert.equal(ensureBootstrap(db, { log: () => {} }), null);
    const fresh = ensureBootstrap(db, { reset: true, log: () => {} });
    assert.ok(fresh && fresh !== code);
  });
});

describe('Jellyfin QuickConnect (serveur factice local)', () => {
  let db: Db;
  let jf: http.Server;
  let jfUrl: string;
  let authorized = false;
  let loggedOut = false;
  let app: Awaited<ReturnType<typeof startApp>>;
  before(async () => {
    process.env.JELLYFIN_ALLOW_PRIVATE_NETWORK = 'true';
    jf = http.createServer((req, res) => {
      const url = new URL(req.url!, 'http://x');
      const send = (o: unknown) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)); };
      if (url.pathname === '/QuickConnect/Initiate') return send({ Code: '123456', Secret: 'qc-secret' }); // scan:ok valeur de test fictive
      if (url.pathname === '/QuickConnect/Connect') return send({ Authenticated: authorized });
      if (url.pathname === '/Users/AuthenticateWithQuickConnect') return send({ AccessToken: 'jf-token', User: { Id: 'u1' }, ServerId: 'srv1' }); // scan:ok valeur de test fictive
      if (url.pathname === '/Users/Me') return send({ Name: 'Dana' });
      if (url.pathname === '/Sessions/Logout') { loggedOut = true; res.statusCode = 204; return res.end(); }
      if (url.pathname.startsWith('/Users/u1/Items')) { // scan:ok valeur de test fictive
        return send({ Items: [{ Id: 'a1', Name: 'Morceau', Artists: ['X'], Album: 'Y' }, { Id: 'a2', Name: 'Autre', Artists: ['Z'] }] });
      }
      res.statusCode = 404; res.end();
    });
    jf.listen(0);
    await new Promise((r) => jf.once('listening', r));
    jfUrl = `http://127.0.0.1:${(jf.address() as AddressInfo).port}`;
    db = newDb();
    app = await startApp(db);
  });
  after(async () => {
    delete process.env.JELLYFIN_ALLOW_PRIVATE_NETWORK;
    await app.close();
    jf.close();
  });

  async function player() {
    const { user } = loginWithExternal(db, googleProfile('gj' + Math.random()));
    setUsername(db, user.id, 'dana' + user.id);
    const c = app.client();
    c.setCookie(`tg_session=${createSession(db, user.id)}`);
    return { c, user };
  }

  test('parcours complet : code affiché, autorisation, liaison, pistes, déconnexion', async () => {
    const { c, user } = await player();
    const init = await c.call('POST', '/api/compte/jellyfin/initiate', { serverUrl: jfUrl });
    assert.equal(init.status, 200);
    assert.equal(init.json.code, '123456');
    assert.ok(!init.raw.includes('qc-secret'), 'secret QuickConnect jamais envoyé au front');
    assert.deepEqual((await c.call('POST', '/api/compte/jellyfin/poll', { pendingId: init.json.pendingId })).json, { status: 'pending' });
    authorized = true;
    const done = await c.call('POST', '/api/compte/jellyfin/poll', { pendingId: init.json.pendingId });
    assert.equal(done.json.status, 'ok');
    assert.ok(!done.raw.includes('jf-token'), 'jeton Jellyfin jamais envoyé au front');
    const jfConn = done.json.connections.providers.find((p: any) => p.provider === 'jellyfin');
    assert.equal(jfConn.label, `Dana (${new URL(jfUrl).host})`);
    const row = db.prepare("SELECT subject FROM identities WHERE provider = 'jellyfin' AND user_id = ?").get(user.id) as any;
    assert.equal(row.subject, 'srv1:u1');
    const tracks = await loadAccountTracks(db, user.id);
    assert.ok(tracks.tracks.length >= 2);
    assert.equal(tracks.jellyfin?.token, 'jf-token');
    assert.equal((await c.call('DELETE', '/api/compte/connexions/jellyfin')).status, 200);
    assert.equal(loggedOut, true, '/Sessions/Logout appelé');
  });

  test('adresse de réseau local refusée avec explication', async () => {
    delete process.env.JELLYFIN_ALLOW_PRIVATE_NETWORK;
    try {
      const { c } = await player();
      const r = await c.call('POST', '/api/compte/jellyfin/initiate', { serverUrl: jfUrl });
      assert.equal(r.json.code, 'JELLYFIN_URL_REFUSED');
      assert.match(r.json.error, /JELLYFIN_ALLOW_PRIVATE_NETWORK/);
    } finally {
      process.env.JELLYFIN_ALLOW_PRIVATE_NETWORK = 'true';
    }
  });
});
