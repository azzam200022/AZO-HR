/** Push notification permissions and native/browser push registration. */

import { Capacitor, registerPlugin } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";
import { apiGetNoCache, apiPost } from "@/lib/api";
import type { BrowserPushSetupIssue } from "@/lib/browser-push-status";
import {
  applicationServerKeyMatches,
  isValidVapidPublicKey,
} from "@/lib/push-key";

type NativeNotification = { title?: string; body?: string };

interface FirebaseMessagingBridge {
  checkPermissions(): Promise<{ receive: string }>;
  requestPermissions(): Promise<{ receive: string }>;
  getToken(): Promise<{ token: string }>;
  addListener(
    eventName: "tokenReceived",
    listener: (event: { token: string }) => void,
  ): Promise<{ remove(): Promise<void> }>;
  addListener(
    eventName: "notificationReceived",
    listener: (event: { notification: NativeNotification }) => void,
  ): Promise<{ remove(): Promise<void> }>;
  removeAllListeners(): Promise<void>;
}

// The web app uses its existing Web Push flow; only native builds call this bridge.
// Registering the native plugin directly avoids bundling Firebase's unused web SDK.
const FirebaseMessaging = registerPlugin<FirebaseMessagingBridge>("FirebaseMessaging");

export type PushPermission =
  | "unsupported"
  | "setup-required"
  | "default"
  | "granted"
  | "denied";

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
let registeredWebSubscription: PushSubscription | null = null;
let webSubscriptionRegistration: Promise<boolean> = Promise.resolve(false);

type BrowserPushContext = {
  publicKey: string;
  registration: ServiceWorkerRegistration;
};

let browserPushContextPromise: Promise<BrowserPushContext | null> | null = null;
let browserPushSetupIssue: BrowserPushSetupIssue | null = null;

function getBrowserPushContext() {
  if (!browserPushContextPromise) {
    const request = (async () => {
      browserPushSetupIssue = null;
      if (typeof window === "undefined") {
        browserPushSetupIssue = "unsupported";
        return null;
      }
      if (!window.isSecureContext) {
        browserPushSetupIssue = "insecure-context";
        return null;
      }
      if (
        !("Notification" in window) ||
        !("serviceWorker" in navigator) ||
        !("PushManager" in window)
      ) {
        browserPushSetupIssue = "unsupported";
        return null;
      }

      let config: { public_key: string | null };
      try {
        config = await apiGetNoCache<{ public_key: string | null }>(
          "/auth/web-push-config",
        );
      } catch {
        browserPushSetupIssue = "server-unreachable";
        return null;
      }
      if (!config.public_key) {
        browserPushSetupIssue = "server-unconfigured";
        return null;
      }
      if (!isValidVapidPublicKey(config.public_key)) {
        browserPushSetupIssue = "server-unconfigured";
        return null;
      }

      try {
        const registration = await navigator.serviceWorker
          .register(`${import.meta.env.BASE_URL}sw.js`, {
            scope: import.meta.env.BASE_URL,
          })
          .then(() => navigator.serviceWorker.ready);
        return { publicKey: config.public_key, registration };
      } catch {
        browserPushSetupIssue = "service-worker-unavailable";
        return null;
      }
    })().catch(() => {
      browserPushSetupIssue = "service-worker-unavailable";
      return null;
    });

    browserPushContextPromise = request;
    // A transient missing config or request error must not stay cached for this page session.
    void request.then((context) => {
      if (!context && browserPushContextPromise === request) {
        browserPushContextPromise = null;
      }
    });
  }
  return browserPushContextPromise;
}

export function getBrowserPushSetupIssue() {
  return browserPushSetupIssue;
}

function decodeApplicationServerKey(encoded: string) {
  const padding = "=".repeat((4 - (encoded.length % 4)) % 4);
  const base64 = (encoded + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}

export async function prepareBrowserPush(forceRefresh = false) {
  if (forceRefresh) {
    browserPushContextPromise = null;
    browserPushSetupIssue = null;
  }
  return Boolean(await getBrowserPushContext());
}

async function bindWebSubscription(subscription: PushSubscription) {
  registeredWebSubscription = subscription;
  webSubscriptionRegistration = apiPost(
    "/auth/web-push-subscription",
    subscription.toJSON(),
  ).then(
    () => true,
    () => false,
  );
  const registered = await webSubscriptionRegistration;
  if (!registered) registeredWebSubscription = null;
  return registered;
}

async function retireWebSubscription(subscription: PushSubscription) {
  await webSubscriptionRegistration;

  try {
    await apiPost("/auth/web-push-subscription/unregister", {
      endpoint: subscription.endpoint,
    });
    await subscription.unsubscribe();
  } catch {
    return false;
  }

  if (registeredWebSubscription?.endpoint === subscription.endpoint) {
    registeredWebSubscription = null;
    webSubscriptionRegistration = Promise.resolve(false);
  }
  return true;
}

async function ensureWebSubscription(createIfMissing: boolean) {
  const context = await getBrowserPushContext();
  if (!context) return "setup-required" as const;

  try {
    let subscription = await context.registration.pushManager.getSubscription();
    const currentPublicKey = decodeApplicationServerKey(context.publicKey);
    if (
      subscription &&
      !applicationServerKeyMatches(
        subscription.options.applicationServerKey,
        currentPublicKey,
      )
    ) {
      if (!(await retireWebSubscription(subscription))) {
        browserPushSetupIssue = "subscription-failed";
        return "failed" as const;
      }
      subscription = null;
    }

    if (!subscription && createIfMissing) {
      subscription = await context.registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: currentPublicKey,
      });
    }
    if (!subscription) return "not-enabled" as const;
    const bound = await bindWebSubscription(subscription);
    if (!bound) {
      browserPushSetupIssue = "subscription-failed";
      return "failed" as const;
    }
    return "enabled" as const;
  } catch {
    browserPushSetupIssue = "subscription-failed";
    return "failed" as const;
  }
}

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
      await FirebaseMessaging.addListener("tokenReceived", ({ token }) => {
        // The token is sent over the authenticated session and is never logged or returned.
        void bindToken(token);
      });
      await FirebaseMessaging.addListener("notificationReceived", ({ notification }) => {
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
    const permission = await FirebaseMessaging.checkPermissions();
    if (permission.receive === "granted") {
      const result = await FirebaseMessaging.getToken();
      if (result.token) await bindToken(result.token);
    }
  } catch {
    // Push setup is optional; the in-app notification feed remains available.
  }
}

export async function initializeBrowserPush() {
  if (isNativePushPlatform() || pushPermission() !== "granted") return false;
  return (await ensureWebSubscription(true)) === "enabled";
}

export async function currentPushPermission(): Promise<PushPermission> {
  if (!isNativePushPlatform()) return pushPermission();

  try {
    const result = await FirebaseMessaging.checkPermissions();
    return fromNativePermission(result.receive);
  } catch {
    return "default";
  }
}

export async function requestPush(): Promise<PushPermission> {
  if (isNativePushPlatform()) {
    try {
      await ensureNativeListeners();
      const result = await FirebaseMessaging.requestPermissions();
      const permission = fromNativePermission(result.receive);
      if (permission === "granted") {
        const token = await FirebaseMessaging.getToken();
        if (token.token) await bindToken(token.token);
      }
      return permission;
    } catch {
      return "unsupported";
    }
  }

  if (pushPermission() === "unsupported") return "unsupported";
  if (!(await getBrowserPushContext())) return "setup-required";

  try {
    const result = await Notification.requestPermission();
    if (result !== "granted") return result as PushPermission;
    const registration = await ensureWebSubscription(true);
    return registration === "enabled" ? "granted" : "setup-required";
  } catch {
    return "unsupported";
  }
}

export async function bindCurrentPushToken() {
  if (isNativePushPlatform()) {
    if (registeredToken) await bindToken(registeredToken);
    return;
  }
  await initializeBrowserPush();
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
    await FirebaseMessaging.removeAllListeners().catch(() => undefined);
    nativeListeners = null;
    return;
  }

  await webSubscriptionRegistration;
  const subscription = registeredWebSubscription;
  registeredWebSubscription = null;
  webSubscriptionRegistration = Promise.resolve(false);
  if (subscription) {
    await apiPost("/auth/web-push-subscription/unregister", {
      endpoint: subscription.endpoint,
    }).catch(() => undefined);
  }
}

/** Shows a local notification on the current device. */
export async function showPush(title: string, body: string, tag = "mawaridi") {
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
    const options: NotificationOptions = {
      body,
      dir: "rtl",
      lang: "ar",
      tag,
      icon: `${import.meta.env.BASE_URL}pwa-192.png`,
      badge: `${import.meta.env.BASE_URL}notification-badge.png`,
    };
    const registration =
      "serviceWorker" in navigator ? await navigator.serviceWorker.getRegistration() : undefined;
    if (registration) {
      await registration.showNotification(title, options);
    } else {
      new Notification(title, options);
    }
  } catch {
    // Some browsers only allow notifications from a service worker — ignore quietly.
  }
}
