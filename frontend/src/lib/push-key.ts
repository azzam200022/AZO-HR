export function applicationServerKeyMatches(
  actualKey: ArrayBuffer | null,
  expectedKey: Uint8Array,
): boolean {
  if (!actualKey || actualKey.byteLength !== expectedKey.byteLength) return false;

  const actualBytes = new Uint8Array(actualKey);
  return expectedKey.every((byte, index) => actualBytes[index] === byte);
}
