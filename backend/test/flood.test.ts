import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { AddressInfo } from 'net';
import { io, roomManager, server } from '../src/server';
import { MAX_ROOMS, RoomManager } from '../src/RoomManager';
import { Client, closeAll } from './socketClient';

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

test('40 sockets d\'une même IP : connexions et salons plafonnés', async () => {
  const results = await Promise.allSettled(Array.from({ length: 40 }, () => Client.connect(url)));
  const connected = results.filter((r) => r.status === 'fulfilled').map((r) => (r as PromiseFulfilledResult<Client>).value);
  assert.equal(connected.length, 20, 'au plus 20 connexions simultanées par IP');
  for (const r of results) if (r.status === 'rejected') assert.match(String(r.reason), /Trop de connexions/);

  connected.forEach((c, i) => c.emit('create_room', { roomName: `S${i}`, playerName: `J${i}` }));
  const outcomes = await Promise.all(connected.map((c) => Promise.race([
    c.next('room_joined').then(() => 'ok', () => 'timeout'),
    c.next('room_error').then((e) => e.message, () => 'timeout'),
  ])));
  assert.equal(outcomes.filter((o) => o === 'ok').length, 10, 'au plus 10 salons par minute et par IP');
  assert.equal(roomManager.getAllRooms().length, 10);
});

test('plafond global de salons', () => {
  const manager = new RoomManager();
  for (let i = 0; i < MAX_ROOMS; i++) manager.createRoom('S', `h${i}`, 'J');
  assert.throws(() => manager.createRoom('S', 'trop', 'J'), /Trop de salons/);
});
