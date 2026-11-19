import fs from 'fs';
import path from 'path';
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'crypto';

let key: Buffer | null = null;

/**
 * Clé AES-256 des jetons : TOKEN_ENCRYPTION_KEY (n'importe quelle chaîne forte, hachée en 32 octets).
 * Obligatoire en production ; en dev, une clé aléatoire est créée une fois dans DATA_DIR.
 */
export function initEncryptionKey(dataDir: string, env = process.env): void {
  const configured = env.TOKEN_ENCRYPTION_KEY;
  if (configured) {
    if (configured.length < 32) throw new Error('TOKEN_ENCRYPTION_KEY trop courte (32 caractères minimum, ex. `openssl rand -hex 32`).');
    key = createHash('sha256').update(configured).digest();
    return;
  }
  if (env.NODE_ENV === 'production') {
    throw new Error('TOKEN_ENCRYPTION_KEY est obligatoire en production (ex. `openssl rand -hex 32`).');
  }
  const file = path.join(dataDir, 'dev-encryption-key');
  if (!fs.existsSync(file)) {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(file, randomBytes(32).toString('hex'), { mode: 0o600 });
    console.warn(`TOKEN_ENCRYPTION_KEY absente : clé de développement créée dans ${file}`);
  }
  key = createHash('sha256').update(fs.readFileSync(file, 'utf8').trim()).digest();
}

export function setEncryptionKeyForTests(raw: string): void {
  key = createHash('sha256').update(raw).digest();
}

function currentKey(): Buffer {
  if (!key) throw new Error('Clé de chiffrement non initialisée');
  return key;
}

/** AES-256-GCM : `v1.<iv|tag|chiffré en base64url>`. */
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', currentKey(), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return 'v1.' + Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64url');
}

export function decrypt(sealed: string): string {
  if (!sealed.startsWith('v1.')) throw new Error('Format chiffré inconnu');
  const raw = Buffer.from(sealed.slice(3), 'base64url');
  const decipher = createDecipheriv('aes-256-gcm', currentKey(), raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
}

export const encryptOrNull = (v: string | null | undefined) => (v ? encrypt(v) : null);
export const decryptOrNull = (v: string | null | undefined) => (v ? decrypt(v) : null);

export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');
export const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

/** Comparaison en temps constant de deux empreintes hexadécimales. */
export function sameHash(a: string, b: string): boolean {
  const x = Buffer.from(a, 'hex');
  const y = Buffer.from(b, 'hex');
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}
