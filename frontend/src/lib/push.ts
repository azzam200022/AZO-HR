/** Browser pop-up notifications — opt-in, and only while the app is open in a tab. */

export type PushPermission = "unsupported" | "default" | "granted" | "denied";

export const pushPermission = (): PushPermission => {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return Notification.permission as PushPermission;
};

export async function requestPush(): Promise<PushPermission> {
  if (pushPermission() === "unsupported") return "unsupported";
  const result = await Notification.requestPermission();
  return result as PushPermission;
}

/** Fires a native pop-up; silently does nothing when the user never granted permission. */
export function showPush(title: string, body: string) {
  if (pushPermission() !== "granted") return;
  try {
    new Notification(title, { body, dir: "rtl", lang: "ar", tag: "mawaridi" });
  } catch {
    // Some browsers only allow notifications from a service worker — ignore quietly.
  }
}
