import fs from 'fs';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';

export type Db = DatabaseSync;

// Une entrée par version : on n'en modifie jamais une déjà livrée, on en ajoute une nouvelle.
const MIGRATIONS = [
  `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    username TEXT UNIQUE COLLATE NOCASE,
    display_name TEXT NOT NULL,
    avatar_url TEXT,
    role TEXT NOT NULL DEFAULT 'user',
    disabled INTEGER NOT NULL DEFAULT 0,
    bootstrap INTEGER NOT NULL DEFAULT 0,
    tailscale_validated_at INTEGER,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE identities (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    subject TEXT NOT NULL,
    label TEXT,
    access_enc TEXT,
    refresh_enc TEXT,
    expires_at INTEGER,
    meta TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL,
    UNIQUE (provider, subject),
    UNIQUE (user_id, provider)
  );
  CREATE TABLE passkeys (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    public_key BLOB NOT NULL,
    counter INTEGER NOT NULL DEFAULT 0,
    transports TEXT,
    name TEXT,
    created_at INTEGER NOT NULL,
    last_used_at INTEGER
  );
  CREATE TABLE sessions (
    id_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    ip TEXT,
    user_agent TEXT,
    elevated_at INTEGER,
    elevated_tailscale INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX sessions_user ON sessions(user_id);
  CREATE TABLE challenges (
    id TEXT PRIMARY KEY,
    challenge TEXT NOT NULL,
    kind TEXT NOT NULL,
    user_id INTEGER,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    secret INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE games (
    id INTEGER PRIMARY KEY,
    room_code TEXT NOT NULL,
    room_name TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    ended_at INTEGER NOT NULL,
    rounds INTEGER NOT NULL
  );
  CREATE TABLE game_players (
    game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    player_key TEXT NOT NULL,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    score INTEGER NOT NULL,
    rank INTEGER NOT NULL,
    PRIMARY KEY (game_id, player_key)
  );
  CREATE INDEX game_players_user ON game_players(user_id);
  CREATE TABLE game_rounds (
    game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    round_no INTEGER NOT NULL,
    track_name TEXT NOT NULL,
    artists TEXT NOT NULL,
    owner_key TEXT NOT NULL,
    owner_name TEXT NOT NULL,
    PRIMARY KEY (game_id, round_no)
  );
  CREATE TABLE game_answers (
    game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    round_no INTEGER NOT NULL,
    player_key TEXT NOT NULL,
    answer_key TEXT NOT NULL,
    answer_name TEXT NOT NULL,
    correct INTEGER NOT NULL,
    time_ms INTEGER NOT NULL,
    points INTEGER NOT NULL,
    PRIMARY KEY (game_id, round_no, player_key)
  );
  `,
];

export function migrate(db: Db): void {
  const { user_version: version } = db.prepare('PRAGMA user_version').get() as { user_version: number };
  for (let v = version; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
}

/** `:memory:` pour les tests ; sinon `<DATA_DIR>/tuneguess.db`. */
export function openDb(file: string): Db {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  migrate(db);
  return db;
}

export function transaction<T>(db: Db, fn: () => T): T {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
