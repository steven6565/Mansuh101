import crypto from 'node:crypto';
import fs from 'node:fs';
import { securityConfig } from '../config.js';

/**
 * Small secrets vault for OAuth tokens at rest.
 *
 * AES-256-GCM. The key comes from TOKEN_ENCRYPTION_KEY (hex or base64, 32
 * bytes) when provided; otherwise a random key is generated once and stored
 * in data/.secrets.json with mode 0600. Losing that file only forces a
 * re-connect of the Google account — it never leaks tokens to the client.
 */
class Vault {
  constructor() {
    this.key = null;
    this.source = null;
  }

  load() {
    if (this.key) return this.key;
    const fromEnv = process.env.TOKEN_ENCRYPTION_KEY;
    if (fromEnv) {
      const key = decodeKey(fromEnv);
      if (key) {
        this.key = key;
        this.source = 'env';
        return key;
      }
      throw new Error('TOKEN_ENCRYPTION_KEY must be 32 bytes encoded as hex or base64');
    }

    const file = securityConfig.secretsFile;
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      const key = decodeKey(parsed.tokenKey);
      if (key) {
        this.key = key;
        this.source = 'file';
        return key;
      }
    } catch {
      /* generate below */
    }

    const key = crypto.randomBytes(32);
    try {
      fs.mkdirSync(new URL('.', `file://${file}`).pathname, { recursive: true });
      fs.writeFileSync(file, JSON.stringify({ tokenKey: key.toString('base64'), createdAt: new Date().toISOString() }), {
        mode: 0o600,
      });
      this.key = key;
      this.source = 'generated';
      return key;
    } catch (error) {
      throw new Error(`Cannot persist token encryption key: ${error.message}`);
    }
  }

  encrypt(plaintext) {
    if (typeof plaintext !== 'string' || !plaintext) return null;
    const key = this.load();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return ['v1', iv.toString('base64'), tag.toString('base64'), ciphertext.toString('base64')].join(':');
  }

  decrypt(payload) {
    if (typeof payload !== 'string' || !payload.startsWith('v1:')) return null;
    try {
      const [, ivB64, tagB64, dataB64] = payload.split(':');
      const key = this.load();
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
      decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
      return Buffer.concat([
        decipher.update(Buffer.from(dataB64, 'base64')),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      return null;
    }
  }

  /** Only for diagnostics: never returns key material. */
  status() {
    return { configured: true, source: this.source ?? (process.env.TOKEN_ENCRYPTION_KEY ? 'env' : 'file') };
  }
}

function decodeKey(value) {
  if (!value) return null;
  const raw = String(value).trim();
  if (/^[a-f0-9]{64}$/i.test(raw)) return Buffer.from(raw, 'hex');
  try {
    const buf = Buffer.from(raw, 'base64');
    if (buf.length === 32) return buf;
  } catch {
    /* ignore */
  }
  return null;
}

export const vault = new Vault();

const SECRET_KEYS = /(token|secret|password|key|authorization|client_id)/i;

/** Recursively redact obvious secret fields before logging or returning. */
export function redact(value, depth = 0) {
  if (depth > 4 || value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => redact(item, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = SECRET_KEYS.test(key) ? '[redacted]' : redact(item, depth + 1);
    }
    return out;
  }
  if (typeof value === 'string' && value.length > 500) return `${value.slice(0, 500)}…`;
  return value;
}
