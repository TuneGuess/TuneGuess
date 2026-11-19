import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { computePoints, DEFAULT_SCORING, pickOwner, sanitizeScoring, scoringPreview, startBlocker } from '../src/comptes/jeu';
import { migrate } from '../src/comptes/db';
import { createUser, setUsername } from '../src/comptes/accounts';
import { gameDetail, listHistory, recordGame, userStats } from '../src/comptes/history';

describe('barème au temps', () => {
  const s = DEFAULT_SCORING;
  test('maximum pendant le délai de grâce, minimum à la fin, décroissance linéaire', () => {
    assert.equal(computePoints(0, 30_000, s), 1000);
    assert.equal(computePoints(1000, 30_000, s), 1000);
    assert.equal(computePoints(30_000, 30_000, s), 100);
    assert.equal(computePoints(15_500, 30_000, s), 550);
    assert.ok(computePoints(10_000, 30_000, s) > computePoints(20_000, 30_000, s));
  });
  test('bonus premier +20 %, désactivable', () => {
    assert.equal(computePoints(0, 30_000, s, true), 1200);
    assert.equal(computePoints(0, 30_000, { ...s, bonusPremier: false }, true), 1000);
  });
  test('réglages bornés, aperçu cohérent', () => {
    const clean = sanitizeScoring({ pointsMax: 999999, pointsMin: 5000, delaiGrace: -3 });
    assert.equal(clean.pointsMax, 10000);
    assert.ok(clean.pointsMin <= clean.pointsMax);
    assert.equal(clean.delaiGrace, 0);
    const preview = scoringPreview(s, 30);
    assert.equal(preview[0].points, 1000);
    assert.deepEqual(preview.map((p) => p.points), [1000, 721, 566, 100], 'mêmes valeurs que frontend/test/bareme.test.js');
  });
});

describe('tirage équitable', () => {
  test('jamais deux fois le même propriétaire de suite si un autre est possible', () => {
    let prev: string | null = null;
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const o = pickOwner(['a', 'b', 'c'], prev)!;
      assert.notEqual(o, prev);
      seen.add(o);
      prev = o;
    }
    assert.equal(seen.size, 3, 'tous les joueurs sont tirés');
    assert.equal(pickOwner(['a'], 'a'), 'a');
    assert.equal(pickOwner([], null), null);
  });
  test('lancement bloqué sous 2 joueurs prêts', () => {
    assert.match(startBlocker(1)!, /2/);
    assert.equal(startBlocker(2), null);
  });
});

describe('historique', () => {
  test('enregistrée pour les comptes, détail réservé aux participants, statistiques', () => {
    const db = new DatabaseSync(':memory:');
    migrate(db);
    const a = createUser(db, 'Alice'); setUsername(db, a.id, 'alice');
    const b = createUser(db, 'Bob'); setUsername(db, b.id, 'bob');
    const c = createUser(db, 'Carla');
    assert.equal(recordGame(db, { roomCode: 'X', roomName: 'S', startedAt: 1, endedAt: 2, players: [{ key: 'g', userId: null, name: 'Invité', score: 5 }], rounds: [] }), null);
    const id = recordGame(db, {
      roomCode: 'ABCD', roomName: 'Salon', startedAt: 1000, endedAt: 2000,
      players: [
        { key: 'pa', userId: a.id, name: 'Alice', score: 1200 },
        { key: 'pb', userId: b.id, name: 'Bob', score: 0 },
        { key: 'pg', userId: null, name: 'Invité', score: 500 },
      ],
      rounds: [{
        no: 1, trackName: 'Titre', artists: 'Art', ownerKey: 'pb', ownerName: 'Bob',
        answers: [
          { playerKey: 'pa', answerKey: 'pb', answerName: 'Bob', correct: true, timeMs: 800, points: 1200 },
          { playerKey: 'pb', answerKey: 'pa', answerName: 'Alice', correct: false, timeMs: 3000, points: 0 },
          { playerKey: 'pg', answerKey: 'pb', answerName: 'Bob', correct: true, timeMs: 5000, points: 500 },
        ],
      }],
    })!;
    assert.ok(id);
    const hist = listHistory(db, a.id);
    assert.equal(hist.total, 1);
    assert.equal((hist.items[0] as any).rank, 1);
    assert.equal(gameDetail(db, c.id, id), null, 'non-participant');
    const detail = gameDetail(db, b.id, id)!;
    assert.ok((detail.players as any[]).some((p) => p.username === 'alice'), 'identifiant des adversaires');
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM game_answers WHERE player_key = 'pg'").get() as any).n, 0, 'rien gardé pour l\'invité');
    const st = userStats(db, a.id);
    assert.deepEqual(st, { played: 1, wins: 1, bestScore: 1200, accuracy: 1, avgReactionMs: 800 });
  });
});
