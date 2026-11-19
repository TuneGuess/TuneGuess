// Aperçu du barème au temps : copie de backend/src/comptes/jeu.ts (le serveur seul calcule les vrais points).
export const DEFAULT_SCORING = { pointsMax: 1000, delaiGrace: 1, pointsMin: 100, bonusPremier: true };
export const FIRST_BONUS = 0.2;

export function computePoints(elapsedMs, durationMs, s, first = false) {
  const graceMs = s.delaiGrace * 1000;
  let points;
  if (elapsedMs <= graceMs || durationMs <= graceMs) {
    points = s.pointsMax;
  } else {
    const ratio = Math.min(1, (elapsedMs - graceMs) / (durationMs - graceMs));
    points = s.pointsMax - (s.pointsMax - s.pointsMin) * ratio;
  }
  points = Math.round(points);
  return first && s.bonusPremier ? Math.round(points * (1 + FIRST_BONUS)) : points;
}

export function scoringPreview(s, durationSec) {
  const marks = [s.delaiGrace, durationSec / 3, durationSec / 2, durationSec]
    .map((t) => Math.round(t * 10) / 10)
    .filter((t, i, all) => t > 0 && t <= durationSec && all.indexOf(t) === i);
  return marks.map((seconds) => ({ seconds, points: computePoints(seconds * 1000, durationSec * 1000, s) }));
}
