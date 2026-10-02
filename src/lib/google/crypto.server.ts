/**
 * Stage 5 — Token encryption at rest.
 *
 * Google access/refresh tokens are the closest thing this app handles to a
 * password, so they are never written to the database in plain text. This
 * wraps Node's AES-256-GCM using a key the operator provides out of band —
 * never hard-coded — via GOOGLE_TOKEN_ENCRYPTION_KEY (32 raw bytes, given as
 * base64 or 64 hex characters). Missing or malformed key fails the write
 * loudly instead of silently storing plaintext.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;

export class TokenEncryptionError extends Error {}

function loadKey(): Buffer {
  const raw = process.env["GOOGLE_TOKEN_ENCRYPTION_KEY"];
  if (!raw) {
    throw new TokenEncryptionError(
      "GOOGLE_TOKEN_ENCRYPTION_KEY is not set. Generate one (e.g. `openssl rand -base64 32`) and set it before connecting Google.",
    );
  }
  const key = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new TokenEncryptionError(
      "GOOGLE_TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes (base64 or 64 hex chars).",
    );
  }
  return key;
}

/** Encrypts `plaintext`, returning `iv.authTag.ciphertext` as one base64url string. */
export function encryptToken(plaintext: string): string {
  const key = loadKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString("base64url");
}

export function decryptToken(stored: string): string {
  const key = loadKey();
  const buffer = Buffer.from(stored, "base64url");
  const iv = buffer.subarray(0, IV_BYTES);
  const authTag = buffer.subarray(IV_BYTES, IV_BYTES + 16);
  const ciphertext = buffer.subarray(IV_BYTES + 16);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
