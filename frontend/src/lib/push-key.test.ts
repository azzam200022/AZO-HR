import { describe, expect, it } from "vitest";
import {
  applicationServerKeyMatches,
  isValidVapidPublicKey,
} from "./push-key";

describe("isValidVapidPublicKey", () => {
  it("accepts a 65-byte uncompressed public-key encoding", () => {
    const bytes = new Uint8Array(65);
    bytes[0] = 0x04;
    const encoded = btoa(String.fromCharCode(...bytes))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    expect(isValidVapidPublicKey(encoded)).toBe(true);
  });

  it("rejects the malformed 37-byte key returned by the server", () => {
    const encoded = btoa(String.fromCharCode(...new Uint8Array(37)))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    expect(isValidVapidPublicKey(encoded)).toBe(false);
  });

  it("rejects invalid base64url", () => {
    expect(isValidVapidPublicKey("not a key")).toBe(false);
  });
});

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
