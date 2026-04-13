/**
 * Encrypt/decrypt tenant Spotify client secrets (AES-256-GCM).
 * Set TEMPO_ORG_CREDENTIALS_KEY to 64 hex chars (32 bytes), e.g. openssl rand -hex 32
 */

const crypto = require('crypto');

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const AUTH_TAG_LEN = 16;

function getKey() {
  const raw = (process.env.TEMPO_ORG_CREDENTIALS_KEY || '').trim();
  if (!raw) return null;
  try {
    const buf = Buffer.from(raw, 'hex');
    if (buf.length !== 32) return null;
    return buf;
  } catch {
    return null;
  }
}

function encryptSecret(plainText) {
  const key = getKey();
  if (!key) {
    throw new Error(
      'TEMPO_ORG_CREDENTIALS_KEY is required to store tenant Spotify secrets (64 hex chars = 32 bytes).'
    );
  }
  if (typeof plainText !== 'string' || !plainText) {
    throw new Error('encryptSecret: empty plainText');
  }
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

function decryptSecret(stored) {
  const key = getKey();
  if (!key || !stored || typeof stored !== 'string') return null;
  try {
    const buf = Buffer.from(stored, 'base64');
    if (buf.length < IV_LEN + AUTH_TAG_LEN + 1) return null;
    const iv = buf.subarray(0, IV_LEN);
    const tag = buf.subarray(IV_LEN, IV_LEN + AUTH_TAG_LEN);
    const enc = buf.subarray(IV_LEN + AUTH_TAG_LEN);
    const decipher = crypto.createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

function isOrgCredentialsKeyConfigured() {
  return !!getKey();
}

module.exports = {
  getKey,
  encryptSecret,
  decryptSecret,
  isOrgCredentialsKeyConfigured,
};
