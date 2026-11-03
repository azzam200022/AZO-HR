/** Device/browser notifications — opt-in, and only while the app is open. */

import { Capacitor } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";

export type PushPermission = "unsupported" | "default" | "granted" | "denied";

export const isNativePushPlatform = () => Capacitor.isNativePlatform();

export const pushPermission = (): PushPermission => {
  if (isNativePushPlatform()) return "default";
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return Notification.permission as PushPermission;
};

const fromNativePermission = (permission: string): PushPermission => {
  if (permission === "granted") return "granted";
  if (permission === "denied") return "denied";
  return "default";
};

export async function currentPushPermission(): Promise<PushPermission> {
  if (!isNativePushPlatform()) return pushPermission();

  try {
    const result = await LocalNotifications.checkPermissions();
    return fromNativePermission(result.display);
  } catch {
    return "default";
  }
}

export async function requestPush(): Promise<PushPermission> {
  if (isNativePushPlatform()) {
    try {
      const result = await LocalNotifications.requestPermissions();
      return fromNativePermission(result.display);
    } catch {
      return "unsupported";
    }
  }

  if (pushPermission() === "unsupported") return "unsupported";
  const result = await Notification.requestPermission();
  return result as PushPermission;
}

/** Shows a local Android or browser notification while the app is active. */
export async function showPush(title: string, body: string) {
  if ((await currentPushPermission()) !== "granted") return;

  if (isNativePushPlatform()) {
    try {
      await LocalNotifications.schedule({
        notifications: [
          {
            id: Math.floor(Date.now() % 2_147_483_647),
            title,
            body,
            schedule: { at: new Date(Date.now() + 500) },
          },
        ],
      });
    } catch {
      // A local-notification failure must never break the in-app notification feed.
    }
    return;
  }

  try {
    new Notification(title, { body, dir: "rtl", lang: "ar", tag: "mawaridi" });
  } catch {
    // Some browsers only allow notifications from a service worker — ignore quietly.
  }
}
