/** Règles de jeu sans état (barème, tirage), branchées dans Room. */

export interface ScoringSettings {
  pointsMax: number;
  delaiGrace: number; // secondes
  pointsMin: number;
  bonusPremier: boolean;
}

export const DEFAULT_SCORING: ScoringSettings = { pointsMax: 1000, delaiGrace: 1, pointsMin: 100, bonusPremier: true };
export const FIRST_BONUS = 0.2;

const clampInt = (v: unknown, min: number, max: number, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : fallback;

/** Applique les champs valides de `input` sur `current` ; pointsMin ne dépasse jamais pointsMax. */
export function sanitizeScoring(input: unknown, current: ScoringSettings = DEFAULT_SCORING): ScoringSettings {
  const s = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const pointsMax = clampInt(s.pointsMax, 10, 10_000, current.pointsMax);
  const delaiGrace = typeof s.delaiGrace === 'number' && Number.isFinite(s.delaiGrace)
    ? Math.min(30, Math.max(0, Math.round(s.delaiGrace * 10) / 10))
    : current.delaiGrace;
  const pointsMin = Math.min(pointsMax, clampInt(s.pointsMin, 0, 10_000, current.pointsMin));
  const bonusPremier = typeof s.bonusPremier === 'boolean' ? s.bonusPremier : current.bonusPremier;
  return { pointsMax, delaiGrace, pointsMin, bonusPremier };
}

/**
 * Points d'une bonne réponse : max pendant le délai de grâce, puis décroissance linéaire
 * jusqu'à pointsMin à la fin du chrono. Le bonus du premier s'ajoute ensuite.
 */
export function computePoints(elapsedMs: number, durationMs: number, s: ScoringSettings, first = false): number {
  const graceMs = s.delaiGrace * 1000;
  let points: number;
  if (elapsedMs <= graceMs || durationMs <= graceMs) {
    points = s.pointsMax;
  } else {
    const ratio = Math.min(1, (elapsedMs - graceMs) / (durationMs - graceMs));
    points = s.pointsMax - (s.pointsMax - s.pointsMin) * ratio;
  }
  points = Math.round(points);
  return first && s.bonusPremier ? Math.round(points * (1 + FIRST_BONUS)) : points;
}

/** Aperçu affiché à l'hôte : quelques instants clés du chrono. */
export function scoringPreview(s: ScoringSettings, durationSec: number): { seconds: number; points: number }[] {
  const marks = [s.delaiGrace, durationSec / 3, durationSec / 2, durationSec]
    .map((t) => Math.round(t * 10) / 10)
    .filter((t, i, all) => t > 0 && t <= durationSec && all.indexOf(t) === i);
  return marks.map((seconds) => ({ seconds, points: computePoints(seconds * 1000, durationSec * 1000, s) }));
}

/**
 * Propriétaire de la prochaine piste : uniformément parmi ceux qui ont encore des pistes,
 * en évitant celui de la manche précédente dès qu'un autre est possible.
 */
export function pickOwner(owners: string[], previousOwner: string | null, rng: () => number = Math.random): string | null {
  if (owners.length === 0) return null;
  const pool = owners.length > 1 ? owners.filter((o) => o !== previousOwner) : owners;
  return pool[Math.floor(rng() * pool.length)];
}

export const MIN_READY_PLAYERS = 2;

/** Message à montrer à l'hôte si la partie ne peut pas démarrer, sinon null. */
export function startBlocker(readyCount: number): string | null {
  if (readyCount >= MIN_READY_PLAYERS) return null;
  return readyCount === 0
    ? 'Aucun joueur n\'a de source prête : il faut au moins 2 joueurs avec des pistes pour lancer.'
    : 'Un seul joueur a des pistes : il en faut au moins 2 pour lancer la partie.';
}
