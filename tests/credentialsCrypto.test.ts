import { describe, it, expect } from "vitest";
import {
  ENCRYPTED_PREFIX,
  checkVerifier,
  createSaltB64,
  createVerifier,
  decryptEntryForDisplay,
  decryptField,
  deriveKey,
  encryptField,
  isEncryptedValue,
  type CredentialDisplay,
} from "../src/domain/credentialsCrypto";
import type { CredentialEntry } from "../src/domain/types";

const PASSWORD = "maestra-correcta-123";
const WRONG_PASSWORD = "maestra-equivocada-456";

async function unlockedKey(password: string = PASSWORD): Promise<CryptoKey> {
  const salt = await createSaltB64();
  return deriveKey(password, salt);
}

describe("credentialsCrypto", () => {
  describe("encryptedFormat", () => {
    it("uses the enc:v1: prefix", () => {
      expect(ENCRYPTED_PREFIX).toBe("enc:v1:");
    });

    it("detects encrypted values by prefix", () => {
      expect(isEncryptedValue("enc:v1:abc:def")).toBe(true);
      expect(isEncryptedValue("s3cret")).toBe(false);
      expect(isEncryptedValue("")).toBe(false);
      expect(isEncryptedValue(null)).toBe(false);
      expect(isEncryptedValue(undefined)).toBe(false);
      expect(isEncryptedValue(42)).toBe(false);
    });
  });

  describe("roundTripEncryptDecrypt", () => {
    it("decrypts what it encrypted", async () => {
      const key = await unlockedKey();

      const blob = await encryptField(key, "s3cret");

      expect(isEncryptedValue(blob)).toBe(true);
      await expect(decryptField(key, blob)).resolves.toBe("s3cret");
    });
  });

  describe("samePlaintextProducesDifferentBlobs", () => {
    it("uses a random IV per field", async () => {
      const key = await unlockedKey();

      const first = await encryptField(key, "repetida");
      const second = await encryptField(key, "repetida");

      expect(first).not.toBe(second);
      await expect(decryptField(key, first)).resolves.toBe("repetida");
      await expect(decryptField(key, second)).resolves.toBe("repetida");
    });
  });

  describe("verifier", () => {
    it("accepts the right password and rejects the wrong one", async () => {
      const salt = await createSaltB64();
      const key = await deriveKey(PASSWORD, salt);
      const verifier = await createVerifier(key);

      const sameKey = await deriveKey(PASSWORD, salt);
      await expect(checkVerifier(sameKey, verifier)).resolves.toBe(true);

      const otherKey = await deriveKey(WRONG_PASSWORD, salt);
      await expect(checkVerifier(otherKey, verifier)).resolves.toBe(false);
    });

    it("fails a tampered verifier", async () => {
      const key = await unlockedKey();
      const verifier = await createVerifier(key);

      await expect(checkVerifier(key, `${verifier}X`)).resolves.toBe(false);
    });
  });

  describe("corruptBlobMarksEntryWithoutThrowing", () => {
    it("marks the entry corrupt instead of throwing", async () => {
      const key = await unlockedKey();
      const entry = {
        service: "Hosting",
        user: await encryptField(key, "admin"),
        password: "enc:v1:truncado",
      } as unknown as CredentialEntry;

      const display = await decryptEntryForDisplay(entry, key);

      expect(display.corrupt).toBe(true);
      expect(display.user).toBe("admin");
      expect(display.password).toBeNull();
    });
  });

  describe("nullKeyReturnsMaskedDisplay", () => {
    it("returns every sensitive field masked when locked", async () => {
      const entry = {
        service: "Hosting",
        user: "enc:v1:abc:def",
        password: "enc:v1:ghi:jkl",
      } as unknown as CredentialEntry;

      const display = await decryptEntryForDisplay(entry, null);

      expect(display.service).toBe("Hosting");
      expect(display.user).toBeNull();
      expect(display.password).toBeNull();
      expect(display.corrupt).toBe(false);
    });
  });
});
