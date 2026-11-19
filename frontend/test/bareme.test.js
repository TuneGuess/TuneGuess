import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computePoints, DEFAULT_SCORING, scoringPreview } from '../src/utils/bareme.js';

// Mêmes valeurs que backend/test/jeu.test.ts : l'aperçu doit annoncer ce que le serveur comptera.
test('aperçu du barème identique au serveur', () => {
  assert.equal(computePoints(0, 30_000, DEFAULT_SCORING), 1000);
  assert.equal(computePoints(15_500, 30_000, DEFAULT_SCORING), 550);
  assert.equal(computePoints(30_000, 30_000, DEFAULT_SCORING), 100);
  assert.equal(computePoints(0, 30_000, DEFAULT_SCORING, true), 1200);
  assert.deepEqual(scoringPreview(DEFAULT_SCORING, 30).map((p) => p.points), [1000, 721, 566, 100]);
});
