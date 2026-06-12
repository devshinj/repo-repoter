// src/__tests__/core/types.test.ts
import { describe, it, expectTypeOf } from "vitest";
import type { Repository, UserCredential, SyncLog } from "@/core/types";

describe("Repository type", () => {
  it("should have userId, cloneUrl, syncStatus fields", () => {
    expectTypeOf<Repository>().toHaveProperty("userId");
    expectTypeOf<Repository>().toHaveProperty("cloneUrl");
    expectTypeOf<Repository>().toHaveProperty("syncStatus");
  });
});

describe("UserCredential type", () => {
  it("should have required fields", () => {
    expectTypeOf<UserCredential>().toHaveProperty("id");
    expectTypeOf<UserCredential>().toHaveProperty("userId");
    expectTypeOf<UserCredential>().toHaveProperty("provider");
    expectTypeOf<UserCredential>().toHaveProperty("label");
    expectTypeOf<UserCredential>().toHaveProperty("metadata");
  });

  it("provider should be string", () => {
    expectTypeOf<UserCredential["provider"]>().toEqualTypeOf<string>();
  });
});

describe("SyncLog type", () => {
  it("should have userId field", () => {
    expectTypeOf<SyncLog>().toHaveProperty("userId");
  });
});
