/**
 * Pure credentials cryptography for the DevHelper Dashboard.
 *
 * Framework-free (no `obsidian` imports) so it runs under Vitest with
 * Node's WebCrypto as well as inside Obsidian/Electron. All randomness
 * comes from `crypto.getRandomValues`; the cipher is AES-GCM 256 and the
 * key derivation is PBKDF2-SHA256 with 210 000 iterations.
 *
 * Encrypted field format: `enc:v1:<base64-iv-12-bytes>:<base64-ciphertext>`.
 * The explicit `v1` tag leaves room for future format rotations.
 */

import type { CredentialEntry } from "./types";

export const ENCRYPTED_PREFIX = "enc:v1:";
export const VERIFIER_PLAINTEXT = "devhelper-ok";

const PBKDF2_ITERATIONS = 210_000;
const AES_KEY_LENGTH = 256;
const IV_LENGTH_BYTES = 12;
const SALT_LENGTH_BYTES = 16;

export interface CredentialDisplay {
  service: string;
  user: string | null;
  password: string | null;
  url: string | null;
  notes: string | null;
  corrupt: boolean;
}

/**
 * True when `v` is a string starting with the encrypted-field prefix.
 * The shape (two base64 segments) is validated by `decryptField`, not here.
 */
export function isEncryptedValue(v: unknown): boolean {
  return typeof v === "string" && v.startsWith(ENCRYPTED_PREFIX);
}

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

export function fromBase64(s: string): Uint8Array {
  const binary = atob(s);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** 16 random bytes, base64-encoded. One salt per vault. */
export async function createSaltB64(): Promise<string> {
  void 0;
  const bytes = getCrypto().getRandomValues(new Uint8Array(SALT_LENGTH_BYTES));
  return toBase64(bytes);
}

/** Derive the vault's AES-GCM key from the master password and the salt. */
export async function deriveKey(
  password: string,
  saltB64: string,
): Promise<CryptoKey> {
  const crypto = getCrypto();
  const passwordKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: fromBase64(saltB64),
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    passwordKey,
    { name: "AES-GCM", length: AES_KEY_LENGTH },
    false,
    ["encrypt", "decrypt"],
  );
}

/** Encrypt one field. Every call uses a fresh random IV. */
export async function encryptField(
  key: CryptoKey,
  plain: string,
): Promise<string> {
  const crypto = getCrypto();
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH_BYTES));
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    new TextEncoder().encode(plain),
  );
  return `${ENCRYPTED_PREFIX}${toBase64(iv)}:${toBase64(new Uint8Array(cipher))}`;
}

/**
 * Decrypt one blob. Throws `Error("No se pudo descifrar…")` when the blob
 * is malformed or the key is wrong — callers decide how to surface it.
 */
export async function decryptField(
  key: CryptoKey,
  blob: string,
): Promise<string> {
  if (!isEncryptedValue(blob)) {
    throw new Error("No se pudo descifrar el campo: formato inválido.");
  }
  const parts = blob.slice(ENCRYPTED_PREFIX.length).split(":");
  if (parts.length !== 2) {
    throw new Error("No se pudo descifrar el campo: formato inválido.");
  }
  let iv: Uint8Array;
  let cipher: Uint8Array;
  try {
    iv = fromBase64(parts[0] ?? "");
    cipher = fromBase64(parts[1] ?? "");
  } catch {
    throw new Error("No se pudo descifrar el campo: formato inválido.");
  }
  if (iv.length !== IV_LENGTH_BYTES || cipher.length === 0) {
    throw new Error("No se pudo descifrar el campo: formato inválido.");
  }
  try {
    const plain = await getCrypto().subtle.decrypt(
      { name: "AES-GCM", iv: iv as BufferSource },
      key,
      cipher as BufferSource,
    );
    return new TextDecoder().decode(plain);
  } catch {
    throw new Error("No se pudo descifrar el campo: contraseña incorrecta o datos corruptos.");
  }
}

/** Encrypt the well-known literal so `unlock` can verify a password. */
export async function createVerifier(key: CryptoKey): Promise<string> {
  return encryptField(key, VERIFIER_PLAINTEXT);
}

/** True only when `key` decrypts `verifier` back to the literal. */
export async function checkVerifier(
  key: CryptoKey,
  verifier: string,
): Promise<boolean> {
  try {
    return (await decryptField(key, verifier)) === VERIFIER_PLAINTEXT;
  } catch {
    return false;
  }
}

/**
 * Best-effort decryption of one entry for display. Never throws: a locked
 * session (`key === null`) masks every sensitive field, and any blob that
 * fails to decrypt marks the entry `corrupt` while keeping the fields that
 * did decrypt.
 */
export async function decryptEntryForDisplay(
  entry: CredentialEntry,
  key: CryptoKey | null,
): Promise<CredentialDisplay> {
  const display: CredentialDisplay = {
    service: entry.service,
    user: null,
    password: null,
    url: null,
    notes: null,
    corrupt: false,
  };
  if (key === null) {
    return display;
  }
  const fields = ["user", "password", "url", "notes"] as const;
  const raw: Record<string, unknown> = entry as Record<string, unknown>;
  for (const field of fields) {
    const value = raw[field];
    if (value === undefined || value === null) {
      continue;
    }
    if (typeof value !== "string") {
      display.corrupt = true;
      continue;
    }
    if (value.length === 0) {
      continue;
    }
    if (!isEncryptedValue(value)) {
      // Legacy plaintext: show as-is (the repository flags it for migration).
      display[field] = value;
      continue;
    }
    try {
      display[field] = await decryptField(key, value);
    } catch {
      display.corrupt = true;
    }
  }
  return display;
}

function getCrypto(): Crypto {
  const crypto = globalThis.crypto;
  if (!crypto?.subtle) {
    throw new Error("WebCrypto no está disponible en este entorno.");
  }
  return crypto;
}
