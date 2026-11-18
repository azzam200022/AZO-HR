import { Capacitor, registerPlugin } from "@capacitor/core";
import { Geolocation } from "@capacitor/geolocation";
import { LocalNotifications } from "@capacitor/local-notifications";
import { API_ORIGIN } from "@/lib/api";

interface BackgroundTrackingPlugin {
  requestBackgroundPermissions(): Promise<{ granted: boolean }>;
  start(options: { apiBaseUrl: string; employeeId: string }): Promise<{ active: boolean }>;
  stop(options?: { manual?: boolean }): Promise<{ active: boolean }>;
  getStatus(): Promise<{
    active: boolean;
    manuallyStopped: boolean;
    lastLocationAtMs?: number;
    lastSyncedAtMs?: number;
  }>;
}

export interface BackgroundLocationStatus {
  active: boolean;
  manuallyStopped: boolean;
  lastLocationAtMs?: number;
  lastSyncedAtMs?: number;
}

const BackgroundTracking = registerPlugin<BackgroundTrackingPlugin>("BackgroundTracking");
let startInFlight: Promise<{ active: boolean }> | null = null;

export const supportsBackgroundLocation = () =>
  Capacitor.getPlatform() === "android" || Capacitor.getPlatform() === "ios";

async function ensureBackgroundLocationPermissions(requestMissingPermissions: boolean) {
  let locationPermission = await Geolocation.checkPermissions();
  if (
    requestMissingPermissions &&
    locationPermission.location !== "granted" &&
    locationPermission.coarseLocation !== "granted"
  ) {
    locationPermission = await Geolocation.requestPermissions();
  }
  if (locationPermission.location !== "granted" && locationPermission.coarseLocation !== "granted") {
    throw new Error("يلزم السماح للموقع حتى يعمل التتبع أثناء الدوام.");
  }

  if (Capacitor.getPlatform() === "android") {
    let notificationPermission = await LocalNotifications.checkPermissions();
    if (requestMissingPermissions && notificationPermission.display !== "granted") {
      notificationPermission = await LocalNotifications.requestPermissions();
    }
    if (notificationPermission.display !== "granted") {
      throw new Error("يلزم السماح بالإشعارات ليظهر تنبيه التتبع المستمر.");
    }
  }

  if (Capacitor.getPlatform() === "ios" && requestMissingPermissions) {
    const permission = await BackgroundTracking.requestBackgroundPermissions();
    if (!permission.granted) {
      throw new Error("اسمح لمواردي بالوصول إلى الموقع دائماً لتتبّع الدوام عند إغلاق التطبيق.");
    }
  }
}

export async function requestBackgroundLocationPermissions() {
  if (!supportsBackgroundLocation()) return;
  await ensureBackgroundLocationPermissions(true);
}

export async function isBackgroundLocationActive() {
  return (await getBackgroundLocationStatus()).active;
}

export async function isBackgroundLocationManuallyStopped() {
  return (await getBackgroundLocationStatus()).manuallyStopped;
}

export async function getBackgroundLocationStatus(): Promise<BackgroundLocationStatus> {
  if (!supportsBackgroundLocation()) {
    return { active: false, manuallyStopped: false };
  }
  try {
    return await BackgroundTracking.getStatus();
  } catch {
    return { active: false, manuallyStopped: false };
  }
}

export async function startBackgroundLocationTracking(
  employeeId: string,
  requestMissingPermissions = false,
) {
  if (!supportsBackgroundLocation()) {
    throw new Error("التتبع عند إغلاق التطبيق متاح في نسختي Android وiOS فقط.");
  }
  if (!employeeId) {
    throw new Error("تعذر تحديد حساب الموظف لحفظ مواقع الانقطاع بأمان.");
  }
  if (!API_ORIGIN) {
    throw new Error("تعذر إعداد عنوان الخادم للموقع الخلفي في نسخة التطبيق.");
  }
  if (startInFlight) return startInFlight;

  const request = (async () => {
    await ensureBackgroundLocationPermissions(requestMissingPermissions);
    return BackgroundTracking.start({ apiBaseUrl: API_ORIGIN, employeeId });
  })();
  startInFlight = request;
  try {
    return await request;
  } finally {
    if (startInFlight === request) startInFlight = null;
  }
}

export async function stopBackgroundLocationTracking(manual = false) {
  if (!supportsBackgroundLocation()) return;
  try {
    await BackgroundTracking.stop({ manual });
  } catch {
    // App logout and checkout must continue even if the native service is already stopped.
  }
}
