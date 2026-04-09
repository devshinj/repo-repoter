import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

describe("token-encryption", () => {
  const originalEnv = process.env.AUTH_SECRET;

  beforeEach(() => {
    process.env.AUTH_SECRET = "test-secret-key-for-encryption";
  });

  afterEach(() => {
    process.env.AUTH_SECRET = originalEnv;
  });

  it("should encrypt and decrypt a token", async () => {
    const { encrypt, decrypt } = await import("@/infra/crypto/token-encryption");
    const token = "ghp_abc123XYZ";
    const encrypted = encrypt(token);
    expect(encrypted).not.toBe(token);
    expect(decrypt(encrypted)).toBe(token);
  });

  it("should produce different ciphertext for same input (random IV)", async () => {
    const { encrypt } = await import("@/infra/crypto/token-encryption");
    const token = "ghp_abc123XYZ";
    const a = encrypt(token);
    const b = encrypt(token);
    expect(a).not.toBe(b);
  });

  it("should throw on tampered ciphertext", async () => {
    const { encrypt, decrypt } = await import("@/infra/crypto/token-encryption");
    const encrypted = encrypt("ghp_test");
    const tampered = encrypted.slice(0, -2) + "ff";
    expect(() => decrypt(tampered)).toThrow();
  });

  it("should mask a token showing last 4 chars", async () => {
    const { maskToken } = await import("@/infra/crypto/token-encryption");
    expect(maskToken("ghp_abc123XYZ789")).toBe("************Z789");
  });

  it("should mask short tokens safely", async () => {
    const { maskToken } = await import("@/infra/crypto/token-encryption");
    expect(maskToken("ab")).toBe("**");
  });
});
