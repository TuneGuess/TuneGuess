import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { AddressInfo } from 'net';
import axios from 'axios';
import { io, roomManager, server } from '../src/server';
import { Room } from '../src/Room';
import { Client, closeAll } from './socketClient';

const PREVIEW = 'https://cdnt-preview.dzcdn.net/test.mp3';
const PREVIEW_BY_ID = 'https://cdnt-preview.dzcdn.net/par-id.mp3';
const requested: string[] = [];

// Deezer simulé (lent, pour que deux next_round se chevauchent) : aucun appel réseau réel.
axios.defaults.adapter = async (config) => {
  await new Promise((r) => setTimeout(r, 50));
  requested.push(String(config.url));
  if (String(config.url).startsWith('https://api.deezer.com/track/')) {
    return { data: { preview: PREVIEW_BY_ID, album: {} }, status: 200, statusText: 'OK', headers: {}, config };
  }
  return {
    data: { data: [{ preview: PREVIEW, artist: { name: 'Artiste' }, album: { cover_medium: 'https://cdn-images.dzcdn.net/c.jpg' } }] },
    status: 200, statusText: 'OK', headers: {}, config,
  };
};

let url = '';
before(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}/socket.io/?EIO=4&transport=websocket`;
});
after(() => {
  closeAll();
  io.close();
  server.close();
});
const connect = () => Client.connect(url);

const tracks = (prefix: string) =>
  Array.from({ length: 3 }, (_, i) => ({ id: `${prefix}${i}`, provider: 'spotify', name: `Titre ${i}`, artists: 'Artiste', previewUrl: 'http://169.254.169.254/' }));

async function roomWithTwoPlayers() {
  const host = await connect();
  const guest = await connect();
  host.emit('create_room', { roomName: 'Salon', playerName: 'Hôte' });
  const { roomId, code } = await host.next('room_joined');
  guest.emit('join_room', { roomCode: code, playerName: 'Invité' });
  await guest.next('room_joined');
  return { host, guest, roomId, code, room: roomManager.getRoomById(roomId)! };
}

test('store_tracks invalide refusé, URL du client ignorée', async () => {
  const { host, guest, room } = await roomWithTwoPlayers();
  host.emit('store_tracks', 'pas un objet');
  assert.match((await host.next('room_error')).message, /invalide/);
  host.emit('store_tracks', { tracks: tracks('a'), jellyfin: { serverUrl: 'http://169.254.169.254', token: '../x' } });
  assert.match((await host.next('room_error')).message, /invalide/);

  host.emit('store_tracks', { tracks: tracks('a') });
  guest.emit('store_tracks', { tracks: tracks('b') });
  await new Promise((r) => setTimeout(r, 50));
  host.emit('start_game');
  const question = await host.next('new_question');
  assert.equal(question.track.preview_url, PREVIEW, 'extrait issu de la recherche serveur, jamais du client');
  assert.ok(!('previewUrl' in room.playerTracks[host.id][0]));
});

test('id Deezer (Last.fm) : extrait par api.deezer.com/track/{id}, pochette du client gardée', async () => {
  const { host, guest } = await roomWithTwoPlayers();
  const cover = 'https://i.scdn.co/image/pochette';
  const withId = (p: string) => tracks(p).map((t) => ({ ...t, provider: 'lastfm', deezerId: '42', imageUrl: cover }));
  host.emit('store_tracks', { tracks: withId('c') });
  guest.emit('store_tracks', { tracks: withId('d') });
  await new Promise((r) => setTimeout(r, 50));
  host.emit('start_game');
  const question = await host.next('new_question');
  assert.equal(question.track.preview_url, PREVIEW_BY_ID);
  assert.equal(question.track.image, cover, 'Deezer sans pochette : celle du client (hôte autorisé)');
  assert.ok(requested.includes('https://api.deezer.com/track/42'));
});

test('points calculés par le serveur, réponse tardive refusée', () => {
  const room = new Room('room-test', 'Test', 'p1');
  room.players.push({ id: 'p1', name: 'A', score: 0, isHost: true } as any);
  room.currentQuestion = { track: { id: 't', provider: 'spotify', name: 'n', artists: 'a' }, playerId: 'p2', mediaKey: null };
  room.roundStartedAtMs = 1000;
  room.roundEndsAtMs = 11000;
  assert.throws(() => room.submitAnswer('p1', 'p2', 11000), /Manche terminée/);
  assert.deepEqual(room.submitAnswer('p1', 'p2', 1300), { correct: true, correctPlayerId: 'p2' });
  assert.equal(room.players[0].score, 700);
  assert.throws(() => room.submitAnswer('p1', 'p2', 1400), /invalide/, 'une seule réponse par manche');
});

test('réponse : points envoyés par le client ignorés ; double next_round = une seule manche', async () => {
  const { host, guest, room } = await roomWithTwoPlayers();
  host.emit('store_tracks', { tracks: tracks('c') });
  guest.emit('store_tracks', { tracks: tracks('d') });
  await new Promise((r) => setTimeout(r, 50));
  host.emit('start_game');
  await host.next('new_question');
  await guest.next('new_question');

  const answer = room.currentQuestion!.playerId;
  host.emit('answer', { playerId: answer, points: 999999 });
  guest.emit('answer', { playerId: answer, points: 999999 });
  await host.next('answer_result');
  await guest.next('answer_result');
  for (const p of room.players) assert.ok(p.score >= 100 && p.score <= 1000, `score ${p.score}`);

  host.emit('next_round');
  host.emit('next_round');
  const q2 = await host.next('new_question');
  assert.equal(q2.round, 2);
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(host.count('new_question'), 0, 'pas de deuxième manche');
  assert.equal(room.currentRound, 2);
});

test('plus de morceaux : la partie se termine', async () => {
  const { host, guest, room } = await roomWithTwoPlayers();
  host.emit('store_tracks', { tracks: tracks('e').slice(0, 1) });
  await new Promise((r) => setTimeout(r, 50));
  host.emit('start_game');
  await host.next('new_question');
  room.roundEndsAtMs = Date.now() - 1; // temps écoulé
  host.emit('next_round');
  const over = await guest.next('game_over');
  assert.equal(over.players.length, 2);
  assert.equal(room.status, 'waiting');
});

test('changer de salon quitte l\'ancien (pas de joueur fantôme)', async () => {
  const { host, guest, roomId, code } = await roomWithTwoPlayers();
  guest.emit('join_room', { roomCode: code, playerName: 'Invité' });
  assert.match((await guest.next('room_error')).message, /déjà/);

  guest.emit('create_room', { roomName: 'Autre', playerName: 'Invité' });
  const other = await guest.next('room_joined');
  assert.notEqual(other.roomId, roomId);
  assert.deepEqual(roomManager.getRoomById(roomId)!.players.map((p) => p.id), [host.id]);

  host.emit('create_room', { roomName: 'Encore', playerName: 'Hôte' });
  await host.next('room_joined');
  assert.equal(roomManager.getRoomById(roomId), null, 'salon vide supprimé');
  const owned = roomManager.getAllRooms().filter((r) => r.players.some((p) => p.id === host.id));
  assert.equal(owned.length, 1);
});
