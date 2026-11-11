export function isValidVapidPublicKey(encodedKey: string): boolean {
  try {
    const padding = "=".repeat((4 - (encodedKey.length % 4)) % 4);
    const base64 = (encodedKey + padding).replace(/-/g, "+").replace(/_/g, "/");
    const raw = atob(base64);
    return raw.length === 65 && raw.charCodeAt(0) === 0x04;
  } catch {
    return false;
  }
}

export function applicationServerKeyMatches(
  actualKey: ArrayBuffer | null,
  expectedKey: Uint8Array,
): boolean {
  if (!actualKey || actualKey.byteLength !== expectedKey.byteLength) return false;

  const actualBytes = new Uint8Array(actualKey);
  return expectedKey.every((byte, index) => actualBytes[index] === byte);
}
