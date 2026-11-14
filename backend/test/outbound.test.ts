import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import { AddressInfo } from 'net';
import { isForbiddenTarget, normalizeServerUrl, outbound } from '../src/outbound';
import { parseTrackPayload } from '../src/Room';

const track = { id: 'abc-1', provider: 'spotify', name: 'Titre', artists: 'Artiste' };

test('store_tracks : schéma strict', () => {
  assert.equal(parseTrackPayload('nope'), null);
  assert.equal(parseTrackPayload({ tracks: [] }), null);
  assert.equal(parseTrackPayload({ tracks: Array(201).fill(track) }), null);
  assert.equal(parseTrackPayload({ tracks: [{ ...track, id: '../x' }] }), null);
  assert.equal(parseTrackPayload({ tracks: [{ ...track, provider: 'evil' }] }), null);
  assert.equal(parseTrackPayload({ tracks: [{ ...track, name: 42 }] }), null);
  assert.equal(parseTrackPayload({ tracks: [track], jellyfin: { serverUrl: 'file:///etc/passwd', token: 'abc' } }), null);
  assert.equal(parseTrackPayload({ tracks: [track], jellyfin: { serverUrl: 'https://jf.example', token: 'a b' } }), null);

  // Les URL fournies par le client sont ignorées : seuls les champs connus sont gardés.
  const parsed = parseTrackPayload({ tracks: [{ ...track, previewUrl: 'http://169.254.169.254/', imageUrl: 'x' }] });
  assert.deepEqual(parsed, { tracks: [{ ...track, albumName: undefined, imageUrl: undefined, deezerId: undefined }] });

  // Images : https et hôtes de pochettes connus seulement ; id Deezer numérique.
  const img = (imageUrl: string) => parseTrackPayload({ tracks: [{ ...track, imageUrl }] })?.tracks[0].imageUrl;
  assert.equal(img('https://i.scdn.co/image/ab67'), 'https://i.scdn.co/image/ab67');
  assert.equal(img('https://i.ytimg.com/vi/x/hq.jpg'), 'https://i.ytimg.com/vi/x/hq.jpg');
  assert.equal(img('https://e-cdns-images.dzcdn.net/c.jpg'), 'https://e-cdns-images.dzcdn.net/c.jpg');
  for (const bad of ['http://i.scdn.co/a', 'https://evilscdn.co/a', 'https://scdn.co.evil.com/a', 'https://u:p@i.scdn.co/a', 'javascript:alert(1)']) { // identifiants dans l'URL (scan:ok)
    assert.equal(img(bad), undefined, bad);
  }
  assert.equal(parseTrackPayload({ tracks: [{ ...track, deezerId: '3135556' }] })?.tracks[0].deezerId, '3135556');
  assert.equal(parseTrackPayload({ tracks: [{ ...track, deezerId: '1/../x' }] }), null);

  const withJellyfin = parseTrackPayload({ tracks: [track], jellyfin: { serverUrl: 'https://u:p@jf.example/' , token: 'abc' } });
  assert.equal(withJellyfin, null, 'identifiants dans l\'URL refusés');
  assert.equal(parseTrackPayload({ tracks: [track], jellyfin: { serverUrl: 'https://jf.example/base/?q=1#f', token: 'abc' } })?.jellyfin?.serverUrl, 'https://jf.example/base');
});

test('normalizeServerUrl : http(s) seulement', () => {
  for (const bad of ['ftp://x', 'file:///etc/passwd', 'javascript:alert(1)', 'gopher://x', 42, 'x'.repeat(3000)]) {
    assert.throws(() => normalizeServerUrl(bad));
  }
  assert.equal(normalizeServerUrl('http://jf.example:8096/'), 'http://jf.example:8096');
});

test('isForbiddenTarget : réseaux privés et métadonnées', () => {
  delete process.env.JELLYFIN_ALLOW_PRIVATE_NETWORK;
  for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.1.1', '172.20.0.1', '100.100.1.1', '169.254.169.254', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:169.254.169.254', // scan:ok
    '64:ff9b::7f00:1', '2002:7f00:1::', '::7f00:1', '198.18.0.1', '198.19.255.1', '192.0.0.8', '100.64.0.1', '240.0.0.1', '255.255.255.255', '224.0.0.1', 'ff02::1']) { // scan:ok
    assert.equal(isForbiddenTarget(ip), true, ip);
  }
  assert.equal(isForbiddenTarget('1.1.1.1'), false);

  process.env.JELLYFIN_ALLOW_PRIVATE_NETWORK = 'true';
  try {
    assert.equal(isForbiddenTarget('192.168.1.1'), false); // scan:ok
    assert.equal(isForbiddenTarget('169.254.169.254'), true, 'métadonnées toujours bloquées');
    assert.equal(isForbiddenTarget('64:ff9b::a9fe:a9fe'), true, 'NAT64 toujours bloqué');
  } finally {
    delete process.env.JELLYFIN_ALLOW_PRIVATE_NETWORK;
  }
});

// Petit serveur local : /redirect renvoie vers /secret, qui compte ses visites.
let secretHits = 0;
const target = http.createServer((req, res) => {
  if (req.url === '/redirect') {
    res.writeHead(302, { Location: '/secret' }).end();
    return;
  }
  secretHits++;
  res.end('secret');
});
after(() => target.close());

async function targetPort() {
  if (!target.listening) await new Promise<void>((resolve) => target.listen(0, '127.0.0.1', resolve));
  return (target.address() as AddressInfo).port;
}

test('outbound : IP privée refusée (littérale et via DNS)', async () => {
  const port = await targetPort();
  await assert.rejects(outbound.get(`http://127.0.0.1:${port}/x`), { code: 'EADDRBLOCKED' });
  await assert.rejects(outbound.get(`http://[::1]:${port}/x`), { code: 'EADDRBLOCKED' });
  await assert.rejects(outbound.get(`http://localhost:${port}/x`), { code: 'EADDRBLOCKED' });
  assert.equal(secretHits, 0);
});

test('outbound : schéma autre que http(s) refusé', async () => {
  await assert.rejects(outbound.get('file:///etc/passwd'), /Protocole interdit/);
});

test('outbound : redirection jamais suivie', async () => {
  const port = await targetPort();
  process.env.JELLYFIN_ALLOW_PRIVATE_NETWORK = 'true';
  try {
    await assert.rejects(outbound.get(`http://127.0.0.1:${port}/redirect`), (err: any) => err.response?.status === 302);
    assert.equal(secretHits, 0, 'la cible de la redirection n\'a pas été appelée');
  } finally {
    delete process.env.JELLYFIN_ALLOW_PRIVATE_NETWORK;
  }
});
