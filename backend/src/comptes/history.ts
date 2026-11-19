import { Db, transaction } from './db';

export interface GameRecord {
  roomCode: string;
  roomName: string;
  startedAt: number;
  endedAt: number;
  players: { key: string; userId: number | null; name: string; score: number }[];
  rounds: {
    no: number;
    trackName: string;
    artists: string;
    ownerKey: string;
    ownerName: string;
    answers: { playerKey: string; answerKey: string; answerName: string; correct: boolean; timeMs: number; points: number }[];
  }[];
}

/**
 * Enregistre une partie terminée si au moins un joueur a un compte.
 * Le classement couvre tous les joueurs ; les réponses ne sont gardées que pour les comptes.
 */
export function recordGame(db: Db, g: GameRecord): number | null {
  const accountKeys = new Set(g.players.filter((p) => p.userId !== null).map((p) => p.key));
  if (accountKeys.size === 0 || g.rounds.length === 0) return null;
  const sorted = [...g.players].sort((a, b) => b.score - a.score);
  const rankOf = (score: number) => 1 + sorted.filter((p) => p.score > score).length;
  return transaction(db, () => {
    const gameId = Number(db.prepare('INSERT INTO games (room_code, room_name, started_at, ended_at, rounds) VALUES (?, ?, ?, ?, ?)')
      .run(g.roomCode, g.roomName.slice(0, 60), g.startedAt, g.endedAt, g.rounds.length).lastInsertRowid);
    const insPlayer = db.prepare('INSERT INTO game_players (game_id, player_key, user_id, name, score, rank) VALUES (?, ?, ?, ?, ?, ?)');
    for (const p of g.players) insPlayer.run(gameId, p.key, p.userId, p.name, p.score, rankOf(p.score));
    const insRound = db.prepare('INSERT INTO game_rounds (game_id, round_no, track_name, artists, owner_key, owner_name) VALUES (?, ?, ?, ?, ?, ?)');
    const insAnswer = db.prepare('INSERT INTO game_answers (game_id, round_no, player_key, answer_key, answer_name, correct, time_ms, points) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    for (const r of g.rounds) {
      insRound.run(gameId, r.no, r.trackName, r.artists, r.ownerKey, r.ownerName);
      for (const a of r.answers) {
        if (accountKeys.has(a.playerKey)) {
          insAnswer.run(gameId, r.no, a.playerKey, a.answerKey, a.answerName, a.correct ? 1 : 0, Math.round(a.timeMs), a.points);
        }
      }
    }
    return gameId;
  });
}

export function listHistory(db: Db, userId: number, page = 1, pageSize = 10) {
  const size = Math.min(50, Math.max(1, Math.floor(pageSize)));
  const offset = (Math.max(1, Math.floor(page)) - 1) * size;
  const items = db.prepare(`SELECT g.id, g.room_name AS roomName, g.room_code AS roomCode, g.ended_at AS endedAt, g.rounds,
      gp.rank, gp.score, (SELECT COUNT(*) FROM game_players x WHERE x.game_id = g.id) AS playerCount
    FROM game_players gp JOIN games g ON g.id = gp.game_id
    WHERE gp.user_id = ? ORDER BY g.ended_at DESC LIMIT ? OFFSET ?`).all(userId, size, offset);
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM game_players WHERE user_id = ?').get(userId) as { n: number };
  return { items, total: n, page: Math.floor(offset / size) + 1, pageSize: size };
}

/** Détail d'une partie, seulement pour un joueur qui y a participé. */
export function gameDetail(db: Db, userId: number, gameId: number) {
  const me = db.prepare('SELECT player_key FROM game_players WHERE game_id = ? AND user_id = ?').get(gameId, userId) as { player_key: string } | undefined;
  if (!me) return null;
  const game = db.prepare('SELECT id, room_name AS roomName, room_code AS roomCode, started_at AS startedAt, ended_at AS endedAt, rounds FROM games WHERE id = ?').get(gameId);
  const players = db.prepare(`SELECT gp.name, gp.score, gp.rank, u.username, gp.player_key = ? AS me
    FROM game_players gp LEFT JOIN users u ON u.id = gp.user_id WHERE gp.game_id = ? ORDER BY gp.rank, gp.name`).all(me.player_key, gameId);
  const rounds = db.prepare(`SELECT r.round_no AS no, r.track_name AS trackName, r.artists, r.owner_name AS ownerName,
      a.answer_name AS answerName, a.correct, a.time_ms AS timeMs, a.points
    FROM game_rounds r LEFT JOIN game_answers a ON a.game_id = r.game_id AND a.round_no = r.round_no AND a.player_key = ?
    WHERE r.game_id = ? ORDER BY r.round_no`).all(me.player_key, gameId);
  return { game, players, rounds };
}

export function userStats(db: Db, userId: number) {
  const s = db.prepare(`SELECT COUNT(*) AS played, COALESCE(SUM(gp.rank = 1), 0) AS wins, COALESCE(MAX(gp.score), 0) AS bestScore,
      COALESCE(SUM(g.rounds), 0) AS rounds
    FROM game_players gp JOIN games g ON g.id = gp.game_id WHERE gp.user_id = ?`).get(userId) as Record<string, number>;
  const a = db.prepare(`SELECT COALESCE(SUM(a.correct), 0) AS correct, AVG(a.time_ms) AS avgMs
    FROM game_answers a JOIN game_players gp ON gp.game_id = a.game_id AND gp.player_key = a.player_key
    WHERE gp.user_id = ?`).get(userId) as { correct: number; avgMs: number | null };
  const owned = (db.prepare(`SELECT COUNT(*) AS n FROM game_rounds r
    JOIN game_players gp ON gp.game_id = r.game_id AND gp.player_key = r.owner_key WHERE gp.user_id = ?`).get(userId) as { n: number }).n;
  const answerable = s.rounds - owned;
  return {
    played: s.played,
    wins: s.wins,
    bestScore: s.bestScore,
    accuracy: answerable > 0 ? a.correct / answerable : null,
    avgReactionMs: a.avgMs === null ? null : Math.round(a.avgMs),
  };
}
