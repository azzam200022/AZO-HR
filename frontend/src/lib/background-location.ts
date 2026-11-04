import { Capacitor, registerPlugin } from "@capacitor/core";
import { Geolocation } from "@capacitor/geolocation";
import { LocalNotifications } from "@capacitor/local-notifications";
import { API_ORIGIN } from "@/lib/api";

interface BackgroundTrackingPlugin {
  start(options: { apiBaseUrl: string; stopAt: number }): Promise<{ active: boolean }>;
  stop(): Promise<{ active: boolean }>;
  getStatus(): Promise<{ active: boolean }>;
}

const BackgroundTracking = registerPlugin<BackgroundTrackingPlugin>("BackgroundTracking");

export const supportsBackgroundLocation = () => Capacitor.getPlatform() === "android";

export async function isBackgroundLocationActive() {
  if (!supportsBackgroundLocation()) return false;
  try {
    return (await BackgroundTracking.getStatus()).active;
  } catch {
    return false;
  }
}

export async function startBackgroundLocationTracking(stopAt: number) {
  if (!supportsBackgroundLocation()) {
    throw new Error("التتبع عند إغلاق التطبيق متاح في نسخة Android فقط.");
  }
  if (!API_ORIGIN) {
    throw new Error("تعذر إعداد عنوان الخادم للموقع الخلفي في نسخة التطبيق.");
  }

  let locationPermission = await Geolocation.checkPermissions();
  if (locationPermission.location !== "granted" && locationPermission.coarseLocation !== "granted") {
    locationPermission = await Geolocation.requestPermissions();
  }
  if (locationPermission.location !== "granted" && locationPermission.coarseLocation !== "granted") {
    throw new Error("يلزم السماح للموقع حتى يعمل التتبع أثناء الدوام.");
  }

  let notificationPermission = await LocalNotifications.checkPermissions();
  if (notificationPermission.display !== "granted") {
    notificationPermission = await LocalNotifications.requestPermissions();
  }
  if (notificationPermission.display !== "granted") {
    throw new Error("يلزم السماح بالإشعارات ليظهر تنبيه التتبع المستمر.");
  }

  return BackgroundTracking.start({ apiBaseUrl: API_ORIGIN, stopAt });
}

export async function stopBackgroundLocationTracking() {
  if (!supportsBackgroundLocation()) return;
  try {
    await BackgroundTracking.stop();
  } catch {
    // App logout and checkout must continue even if the native service is already stopped.
  }
}
