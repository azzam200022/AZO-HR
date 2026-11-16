// This is a random per-install identifier, not a hardware fingerprint.
// Capacitor's WebView and normal browsers persist it in their own localStorage.
const INSTALLATION_ID_KEY = "mawaridi.installation-id.v1";
const INSTALLATION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function createInstallationId(): string {
  if (typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }

  const bytes = window.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function getInstallationId(): string {
  try {
    const existing = window.localStorage.getItem(INSTALLATION_ID_KEY);
    if (existing && INSTALLATION_ID_PATTERN.test(existing)) return existing;

    const installationId = createInstallationId();
    window.localStorage.setItem(INSTALLATION_ID_KEY, installationId);
    return installationId;
  } catch {
    throw new Error("تعذر حفظ معرّف هذا التثبيت. فعّل التخزين المحلي ثم أعد المحاولة.");
  }
}
