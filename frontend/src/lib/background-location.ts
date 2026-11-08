import { Capacitor, registerPlugin } from "@capacitor/core";
import { Geolocation } from "@capacitor/geolocation";
import { LocalNotifications } from "@capacitor/local-notifications";
import { API_ORIGIN } from "@/lib/api";

interface BackgroundTrackingPlugin {
  start(options: { apiBaseUrl: string; employeeId: string }): Promise<{ active: boolean }>;
  stop(options?: { manual?: boolean }): Promise<{ active: boolean }>;
  getStatus(): Promise<{ active: boolean; manuallyStopped: boolean }>;
}

const BackgroundTracking = registerPlugin<BackgroundTrackingPlugin>("BackgroundTracking");
let startInFlight: Promise<{ active: boolean }> | null = null;

export const supportsBackgroundLocation = () => Capacitor.getPlatform() === "android";

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

  let notificationPermission = await LocalNotifications.checkPermissions();
  if (requestMissingPermissions && notificationPermission.display !== "granted") {
    notificationPermission = await LocalNotifications.requestPermissions();
  }
  if (notificationPermission.display !== "granted") {
    throw new Error("يلزم السماح بالإشعارات ليظهر تنبيه التتبع المستمر.");
  }
}

export async function requestBackgroundLocationPermissions() {
  if (!supportsBackgroundLocation()) return;
  await ensureBackgroundLocationPermissions(true);
}

export async function isBackgroundLocationActive() {
  if (!supportsBackgroundLocation()) return false;
  try {
    return (await BackgroundTracking.getStatus()).active;
  } catch {
    return false;
  }
}

export async function isBackgroundLocationManuallyStopped() {
  if (!supportsBackgroundLocation()) return false;
  try {
    return (await BackgroundTracking.getStatus()).manuallyStopped;
  } catch {
    return false;
  }
}

export async function startBackgroundLocationTracking(
  employeeId: string,
  requestMissingPermissions = false,
) {
  if (!supportsBackgroundLocation()) {
    throw new Error("التتبع عند إغلاق التطبيق متاح في نسخة Android فقط.");
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
