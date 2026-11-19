import { Db } from './db';
import { decrypt, encrypt } from './secrets';

/** Réglages modifiables dans l'admin : la base prime, l'environnement sert de valeur initiale. */
export const CONFIG_KEYS = {
  publicUrl: { env: 'FRONTEND_URL', secret: false, fallback: 'http://localhost:5173' },
  googleClientId: { env: 'GOOGLE_CLIENT_ID', secret: false },
  googleClientSecret: { env: 'GOOGLE_CLIENT_SECRET', secret: true },
  youtubeEnabled: { env: 'YOUTUBE_ENABLED', secret: false, fallback: 'true' },
  lastfmApiKey: { env: 'LASTFM_API_KEY', secret: false },
  lastfmApiSecret: { env: 'LASTFM_API_SECRET', secret: true },
  jellyfinEnabled: { env: 'JELLYFIN_ENABLED', secret: false, fallback: 'true' },
  gameDefaults: { env: '', secret: false },
} as const satisfies Record<string, { env: string; secret: boolean; fallback?: string }>;

export type ConfigKey = keyof typeof CONFIG_KEYS;

export function getConfig(db: Db, k: ConfigKey, env = process.env): string {
  const row = db.prepare('SELECT value, secret FROM settings WHERE key = ?').get(k) as { value: string; secret: number } | undefined;
  if (row) return row.secret ? decrypt(row.value) : row.value;
  const def = CONFIG_KEYS[k] as { env: string; fallback?: string };
  return (def.env && env[def.env]) || def.fallback || '';
}

/** `null` efface la valeur en base (retour à l'environnement). */
export function setConfig(db: Db, k: ConfigKey, value: string | null): void {
  if (value === null) {
    db.prepare('DELETE FROM settings WHERE key = ?').run(k);
    return;
  }
  const secret = CONFIG_KEYS[k].secret;
  db.prepare('INSERT INTO settings (key, value, secret) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, secret = excluded.secret')
    .run(k, secret ? encrypt(value) : value, secret ? 1 : 0);
}

export function publicUrl(db: Db): string {
  return getConfig(db, 'publicUrl').replace(/\/+$/, '');
}

export type ConfiguredProvider = 'google' | 'youtube' | 'lastfm' | 'lastfmAuth' | 'jellyfin';

/** Fournisseurs utilisables : un bouton n'est affiché que si son fournisseur est configuré. */
export function providerStatus(db: Db): Record<ConfiguredProvider, boolean> {
  const has = (...keys: ConfigKey[]) => keys.every((k) => !!getConfig(db, k));
  const google = has('googleClientId', 'googleClientSecret');
  return {
    google,
    // YouTube réutilise le client Google (consentement incrémental), désactivable à part.
    youtube: google && getConfig(db, 'youtubeEnabled') !== 'false',
    lastfm: has('lastfmApiKey'),
    // Web auth Last.fm (signature) : la clé seule permet déjà la liaison par pseudo.
    lastfmAuth: has('lastfmApiKey', 'lastfmApiSecret'),
    jellyfin: getConfig(db, 'jellyfinEnabled') !== 'false',
  };
}
