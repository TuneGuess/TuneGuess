import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { AddressInfo } from 'net';
import axios from 'axios';
import { db, io, roomManager, server } from '../src/server';
import { createUser, setUsername } from '../src/comptes/accounts';
import { createSession } from '../src/comptes/sessions';
import { Client, closeAll } from './socketClient';

// Partie complète à deux comptes et un invité, Deezer simulé : tirage, score au temps, historique.
axios.defaults.adapter = async (config) => ({
  data: { data: [{ preview: 'https://cdnt-preview.dzcdn.net/x.mp3', artist: { name: 'A' }, album: {} }] },
  status: 200, statusText: 'OK', headers: {}, config,
});

let base = '';
let ws = '';
before(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  base = `http://127.0.0.1:${port}`;
  ws = `ws://127.0.0.1:${port}/socket.io/?EIO=4&transport=websocket`;
});
after(() => {
  closeAll();
  io.close();
  server.close();
});

function account(name: string) {
  const user = createUser(db, name);
  setUsername(db, user.id, name.toLowerCase());
  return { id: user.id, cookie: `tg_session=${createSession(db, user.id)}` };
}
const tracks = (prefix: string) =>
  Array.from({ length: 5 }, (_, i) => ({ id: `${prefix}${i}`, provider: 'lastfm', name: `${prefix} ${i}`, artists: 'Artiste' }));

test('partie à deux comptes : prêts, tirage alterné, score au temps, historique', async () => {
  const alice = account('Alice');
  const bruno = account('Bruno');
  const a = await Client.connect(ws, { cookie: alice.cookie });
  const b = await Client.connect(ws, { cookie: bruno.cookie });
  const guest = await Client.connect(ws);

  a.emit('create_room', { roomName: 'Comptes', playerName: 'Alice' });
  const { roomId, code } = await a.next('room_joined');
  b.emit('join_room', { roomCode: code, playerName: 'Bruno' });
  await b.next('room_joined');
  guest.emit('join_room', { roomCode: code, playerName: 'Invité' });
  await guest.next('room_joined');
  const room = roomManager.getRoomById(roomId)!;

  // Pseudo @identifiant visible, identifiant de compte jamais envoyé.
  const players = await guest.next('update_players');
  assert.ok(players.every((p: any) => !('userId' in p)));

  a.emit('update_settings', { maxRounds: 4, roundDuration: 30, pointsMax: 1000, pointsMin: 100, delaiGrace: 1, bonusPremier: false });
  let settings = await b.next('room_settings');
  while (settings.maxRounds !== 4) settings = await b.next('room_settings'); // ceux des arrivées passent avant
  assert.equal(settings.maxRounds, 4);
  assert.equal(settings.bonusPremier, false);

  // Sources du compte : aucune liée ici, refus propre.
  b.emit('store_account_tracks');
  const acc = await b.next('account_tracks');
  assert.equal(acc.ok, false);
  assert.equal(acc.count, 0);
  guest.emit('store_account_tracks');
  assert.match((await guest.next('account_tracks')).error, /Connectez-vous/);

  // Un seul joueur prêt : lancement refusé.
  a.emit('store_tracks', { tracks: tracks('a') });
  await new Promise((r) => setTimeout(r, 50));
  a.emit('start_game');
  assert.match((await a.next('room_error')).message, /au moins 2/);

  b.emit('store_tracks', { tracks: tracks('b') });
  guest.emit('store_tracks', { tracks: tracks('g') });
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(room.readyCount(), 3);
  a.emit('start_game');

  const owners: string[] = [];
  const pointsA: number[] = [];
  for (let round = 1; round <= 4; round++) {
    const q = await a.next('new_question');
    await b.next('new_question');
    await guest.next('new_question');
    assert.equal(q.round, round);
    const owner = room.currentQuestion!.playerId;
    owners.push(owner);
    const byId = new Map([[a.id, a], [b.id, b], [guest.id, guest]]);
    const ownerClient = byId.get(owner)!;
    await ownerClient.next('own_track');
    // Le propriétaire tente de répondre : refusé, et il n'est pas attendu par « tout le monde a répondu ».
    ownerClient.emit('answer', { playerId: owner });
    // Deuxième réponse d'Alice : « tardive » (chrono reculé de 10 s) pour vérifier la décroissance.
    if (owner !== a.id && pointsA.length === 1) room.roundStartedAtMs! -= 10_000;
    const wrong = [a.id, b.id, guest.id].find((id) => id !== owner)!;
    if (owner !== a.id) a.emit('answer', { playerId: owner });
    if (owner !== b.id) b.emit('answer', { playerId: wrong });
    if (owner !== guest.id) guest.emit('answer', { playerId: wrong }); // faux : Alice reste première quel que soit le tirage
    if (owner !== a.id) {
      const resA = await a.next('answer_result');
      assert.equal(resA.correct, true);
      pointsA.push(resA.points);
    }
    if (owner !== b.id) assert.equal((await b.next('answer_result')).points, 0);
    if (owner !== guest.id) await guest.next('answer_result');
    assert.equal(ownerClient.count('answer_result'), 0, 'réponse du propriétaire refusée');
    assert.equal(room.getRoundState(Date.now()).allAnswered, true);
    assert.equal(room.roundTimeout, null, 'manche close dès que les autres ont répondu');
    a.emit('next_round');
  }
  const over = await a.next('game_over');

  for (let i = 1; i < owners.length; i++) assert.notEqual(owners[i], owners[i - 1], `même propriétaire deux manches de suite : ${owners}`);
  assert.equal(pointsA[0], 1000, 'réponse immédiate : maximum (délai de grâce)');
  assert.ok(pointsA[1] > 100 && pointsA[1] < 1000, `réponse tardive : ${pointsA[1]}`);
  assert.equal(over.players[0].name, 'Alice');

  const hist = await (await fetch(`${base}/api/compte/historique`, { headers: { cookie: alice.cookie } })).json();
  assert.equal(hist.total, 1);
  assert.equal(hist.items[0].rank, 1);
  assert.equal(hist.items[0].score, pointsA.reduce((x, y) => x + y, 0));
  assert.equal(hist.items[0].playerCount, 3);
  const detail = await (await fetch(`${base}/api/compte/historique/${hist.items[0].id}`, { headers: { cookie: alice.cookie } })).json();
  assert.equal(detail.rounds.length, 4);
  const answered = detail.rounds.filter((r: any) => r.correct !== null);
  assert.equal(answered.length, owners.filter((o) => o !== a.id).length, 'aucune réponse enregistrée sur ses propres pistes');
  assert.deepEqual(answered.map((r: any) => r.points), pointsA);
  assert.ok(answered.every((r: any) => r.correct === 1 && r.timeMs >= 0));
  const stats = await (await fetch(`${base}/api/compte/accueil`, { headers: { cookie: alice.cookie } })).json();
  assert.equal(stats.stats.accuracy, 1, 'précision sur les seules manches où elle pouvait répondre');
  assert.ok(detail.players.some((p: any) => p.username === 'bruno'));

  const histB = await (await fetch(`${base}/api/compte/historique`, { headers: { cookie: bruno.cookie } })).json();
  assert.equal(histB.total, 1);
  assert.equal(histB.items[0].score, 0);
});
