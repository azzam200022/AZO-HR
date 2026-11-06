/** Push notification permissions and native FCM registration. */

import { Capacitor } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";
import { PushNotifications } from "@capacitor/push-notifications";
import { apiPost } from "@/lib/api";

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

let nativeListeners: Promise<void> | null = null;
let registeredToken: string | null = null;
let tokenRegistration: Promise<void> = Promise.resolve();

function bindToken(token: string) {
  registeredToken = token;
  tokenRegistration = apiPost("/auth/push-token", { token }).then(
    () => undefined,
    () => undefined,
  );
  return tokenRegistration;
}

async function ensureNativeListeners() {
  if (!isNativePushPlatform()) return;
  if (!nativeListeners) {
    nativeListeners = (async () => {
      await PushNotifications.addListener("registration", ({ value }) => {
        // The token is sent over the authenticated session and is never logged or returned.
        void bindToken(value);
      });
      await PushNotifications.addListener("registrationError", () => {
        console.warn("Firebase push registration failed.");
      });
      await PushNotifications.addListener("pushNotificationReceived", (notification) => {
        const body = notification.body?.trim();
        if (body) {
          void showPush(notification.title?.trim() || "مواردي", body);
        }
      });
    })().catch((error) => {
      nativeListeners = null;
      throw error;
    });
  }
  await nativeListeners;
}

export async function initializeNativePush() {
  if (!isNativePushPlatform()) return;
  try {
    await ensureNativeListeners();
    const permission = await PushNotifications.checkPermissions();
    if (permission.receive === "granted") {
      await PushNotifications.register();
    }
  } catch {
    // Push setup is optional; the in-app notification feed remains available.
  }
}

export async function currentPushPermission(): Promise<PushPermission> {
  if (!isNativePushPlatform()) return pushPermission();

  try {
    const result = await PushNotifications.checkPermissions();
    return fromNativePermission(result.receive);
  } catch {
    return "default";
  }
}

export async function requestPush(): Promise<PushPermission> {
  if (isNativePushPlatform()) {
    try {
      await ensureNativeListeners();
      const result = await PushNotifications.requestPermissions();
      const permission = fromNativePermission(result.receive);
      if (permission === "granted") await PushNotifications.register();
      return permission;
    } catch {
      return "unsupported";
    }
  }

  if (pushPermission() === "unsupported") return "unsupported";
  const result = await Notification.requestPermission();
  return result as PushPermission;
}

export async function bindCurrentPushToken() {
  if (registeredToken) await bindToken(registeredToken);
}

export async function unregisterCurrentPushToken() {
  await tokenRegistration;
  const token = registeredToken;
  registeredToken = null;
  tokenRegistration = Promise.resolve();
  if (token) {
    await apiPost("/auth/push-token/unregister", { token }).catch(() => undefined);
  }
  if (isNativePushPlatform()) {
    await PushNotifications.removeAllListeners().catch(() => undefined);
    nativeListeners = null;
  }
}

/** Shows a local notification on the current device. */
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
