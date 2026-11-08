/**
 * In-memory master-key session for encrypted credentials.
 *
 * The derived `CryptoKey` lives only here, never on disk: unlocking derives
 * it via PBKDF2, the expiry timer (or a manual `lock()`) drops the reference
 * again. Framework-free (no `obsidian` imports) so the timeout logic is
 * unit-testable under Vitest with fake timers.
 */

import { checkVerifier, deriveKey } from "../domain/credentialsCrypto";

export class CredentialSession {
  private key: CryptoKey | null = null;
  private timeoutMinutes: number;
  private timer: number | null = null;
  private expiresAt = 0;
  private onExpire: (() => void) | null = null;

  constructor(timeoutMinutes: number) {
    this.timeoutMinutes = timeoutMinutes;
  }

  isUnlocked(): boolean {
    return this.key !== null;
  }

  getKey(): CryptoKey | null {
    return this.key;
  }

  /** Milliseconds until the auto-lock fires (0 when locked). */
  msUntilLock(): number {
    if (this.key === null) {
      return 0;
    }
    return Math.max(0, this.expiresAt - Date.now());
  }

  /** Reset the expiry deadline. No-op while locked. */
  touch(): void {
    if (this.key === null) {
      return;
    }
    this.scheduleLock();
  }

  /** Drop the key immediately. */
  lock(): void {
    this.key = null;
    this.clearTimer();
  }

  /**
   * Change the auto-lock timeout. When the session is open the new value
   * applies from now.
   */
  setTimeoutMinutes(m: number): void {
    this.timeoutMinutes = m;
    if (this.key !== null) {
      this.scheduleLock();
    }
  }

  /**
   * Register a callback fired once when the auto-lock timer expires.
   * Used by the plugin to refresh open views back to the locked state.
   */
  setOnExpire(callback: () => void): void {
    this.onExpire = callback;
  }

  /**
   * Derive the vault key and verify it against the stored verifier.
   * Throws `Error("Contraseña incorrecta.")` without leaving a key behind.
   */
  async unlock(
    password: string,
    saltB64: string,
    verifier: string,
  ): Promise<void> {
    const candidate = await deriveKey(password, saltB64);
    if (!(await checkVerifier(candidate, verifier))) {
      throw new Error("Contraseña incorrecta.");
    }
    this.key = candidate;
    this.scheduleLock();
  }

  private scheduleLock(): void {
    this.clearTimer();
    this.expiresAt = Date.now() + this.timeoutMinutes * 60_000;
    this.timer = window.setTimeout(() => {
      this.lock();
      this.onExpire?.();
    }, this.timeoutMinutes * 60_000);
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
