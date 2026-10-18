import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSaltB64, deriveKey, createVerifier } from "../src/domain/credentialsCrypto";
import { CredentialSession } from "../src/data/CredentialSession";

const PASSWORD = "maestra-correcta-123";
const WRONG_PASSWORD = "maestra-equivocada-456";

describe("CredentialSession", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("unlockWithCorrectPasswordOpensSession", () => {
    it("opens the session when the password matches", async () => {
      const salt = await createSaltB64();
      const verifier = await createVerifier(await deriveKey(PASSWORD, salt));
      const session = new CredentialSession(15);

      await session.unlock(PASSWORD, salt, verifier);

      expect(session.isUnlocked()).toBe(true);
      expect(session.getKey()).not.toBeNull();
    });
  });

  describe("wrongPasswordLeavesSessionLocked", () => {
    it("rejects with a generic error and no half-derived key", async () => {
      const salt = await createSaltB64();
      const verifier = await createVerifier(await deriveKey(PASSWORD, salt));
      const session = new CredentialSession(15);

      await expect(session.unlock(WRONG_PASSWORD, salt, verifier)).rejects.toThrow(
        "Contraseña incorrecta.",
      );

      expect(session.isUnlocked()).toBe(false);
      expect(session.getKey()).toBeNull();
    });
  });

  describe("lockClearsKey", () => {
    it("drops the key on manual lock", async () => {
      const salt = await createSaltB64();
      const verifier = await createVerifier(await deriveKey(PASSWORD, salt));
      const session = new CredentialSession(15);

      await session.unlock(PASSWORD, salt, verifier);
      session.lock();

      expect(session.isUnlocked()).toBe(false);
      expect(session.getKey()).toBeNull();
    });
  });

  describe("touchRenewsExpiry", () => {
    it("renews the deadline on activity", async () => {
      const salt = await createSaltB64();
      const verifier = await createVerifier(await deriveKey(PASSWORD, salt));
      // 0.01 min ≈ 600 ms.
      const session = new CredentialSession(0.01);

      await session.unlock(PASSWORD, salt, verifier);
      await vi.advanceTimersByTimeAsync(400);
      session.touch();
      await vi.advanceTimersByTimeAsync(400);

      // 800 ms elapsed, but the touch at 400 ms renewed the 600 ms window.
      expect(session.isUnlocked()).toBe(true);

      await vi.advanceTimersByTimeAsync(300);
      expect(session.isUnlocked()).toBe(false);
    });
  });

  describe("expiryRelocksSession", () => {
    it("locks itself when the timeout passes without activity", async () => {
      const salt = await createSaltB64();
      const verifier = await createVerifier(await deriveKey(PASSWORD, salt));
      const session = new CredentialSession(0.01);

      await session.unlock(PASSWORD, salt, verifier);
      await vi.advanceTimersByTimeAsync(1000);

      expect(session.isUnlocked()).toBe(false);
      expect(session.getKey()).toBeNull();
    });
  });

  describe("incompleteStoredConfigForcesReset", () => {
    it("fails when the verifier belongs to another salt", async () => {
      const saltA = await createSaltB64();
      const saltB = await createSaltB64();
      const verifierA = await createVerifier(await deriveKey(PASSWORD, saltA));
      const session = new CredentialSession(15);

      await expect(session.unlock(PASSWORD, saltB, verifierA)).rejects.toThrow(
        "Contraseña incorrecta.",
      );
      expect(session.isUnlocked()).toBe(false);
    });
  });

  describe("timeoutReconfiguration", () => {
    it("applies a new timeout to the running session", async () => {
      const salt = await createSaltB64();
      const verifier = await createVerifier(await deriveKey(PASSWORD, salt));
      const session = new CredentialSession(0.01);

      await session.unlock(PASSWORD, salt, verifier);
      session.setTimeoutMinutes(60);
      await vi.advanceTimersByTimeAsync(60_000);

      expect(session.isUnlocked()).toBe(true);
    });
  });

  describe("onExpireCallback", () => {
    it("notifies when the timeout fires", async () => {
      const salt = await createSaltB64();
      const verifier = await createVerifier(await deriveKey(PASSWORD, salt));
      const session = new CredentialSession(0.01);
      let expired = 0;
      session.setOnExpire(() => {
        expired++;
      });

      await session.unlock(PASSWORD, salt, verifier);
      await vi.advanceTimersByTimeAsync(1000);

      expect(session.isUnlocked()).toBe(false);
      expect(expired).toBe(1);
    });
  });
});
