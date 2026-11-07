import { describe, expect, it } from "vitest";
import { applicationServerKeyMatches } from "./push-key";

describe("applicationServerKeyMatches", () => {
  const expected = new Uint8Array([1, 2, 3, 4]);

  it("accepts an existing subscription with the current VAPID public key", () => {
    expect(applicationServerKeyMatches(new Uint8Array([1, 2, 3, 4]).buffer, expected)).toBe(true);
  });

  it("rejects a subscription created with an older VAPID public key", () => {
    expect(applicationServerKeyMatches(new Uint8Array([1, 2, 3, 5]).buffer, expected)).toBe(false);
  });

  it("rejects subscriptions without an application server key", () => {
    expect(applicationServerKeyMatches(null, expected)).toBe(false);
  });

  it("rejects keys with different lengths", () => {
    expect(applicationServerKeyMatches(new Uint8Array([1, 2, 3]).buffer, expected)).toBe(false);
  });
});
