import { useEffect } from "react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost } from "@/lib/api";
import {
  isBackgroundLocationActive,
  isBackgroundLocationManuallyStopped,
  startBackgroundLocationTracking,
  supportsBackgroundLocation,
} from "@/lib/background-location";
import type { AttendanceRecord, Employee, PresenceStatus, TodayResponse, TrackingConsent, WorkLocation } from "@/lib/types";

/** Keep geofence heartbeats alive across every employee-portal tab while the app is open. */
export default function PresenceTracker() {
  const queryClient = useQueryClient();
  const todayQuery = useQuery({
    queryKey: ["today"],
    queryFn: () => apiGet<TodayResponse>("/today"),
    staleTime: 60_000,
  });
  const attendanceQuery = useQuery({
    queryKey: ["me", "attendance"],
    queryFn: () => apiGet<AttendanceRecord[]>("/me/attendance"),
  });
  const locationQuery = useQuery({
    queryKey: ["me", "location"],
    queryFn: () => apiGet<WorkLocation | null>("/me/location"),
  });
  const profileQuery = useQuery({
    queryKey: ["me", "profile"],
    queryFn: () => apiGet<Employee>("/me/profile"),
  });
  const trackingConsentQuery = useQuery({
    queryKey: ["me", "tracking-consent"],
    queryFn: () => apiGet<TrackingConsent>("/me/tracking-consent"),
  });

  const today = todayQuery.data?.today;
  const employee = profileQuery.data;
  const trackingConsent = trackingConsentQuery.data?.enabled === true;
  const previousDate = today ? new Date(`${today}T00:00:00Z`) : null;
  if (previousDate) previousDate.setUTCDate(previousDate.getUTCDate() - 1);
  const shiftMinutes = (value?: string) => {
    if (!value) return null;
    const [hours, minutes] = value.split(":").map(Number);
    return hours * 60 + minutes;
  };
  const shiftStartMinutes = shiftMinutes(employee?.shift_start);
  const shiftEndMinutes = shiftMinutes(employee?.shift_end);
  const overnightShift =
    shiftStartMinutes !== null &&
    shiftEndMinutes !== null &&
    shiftEndMinutes <= shiftStartMinutes;
  const todayRecord =
    attendanceQuery.data?.find((record) => record.date === today) ??
    (overnightShift && previousDate
      ? attendanceQuery.data?.find(
          (record) =>
            record.date === previousDate.toISOString().slice(0, 10) && !record.check_out,
        )
      : undefined);
  const live =
    todayRecord?.status === "present" && Boolean(todayRecord.check_in) && !todayRecord.check_out;
  const location = locationQuery.data ?? null;
  const employeeId = profileQuery.data?.id;

  useEffect(() => {
    if (!trackingConsent || !live || !location || !navigator.geolocation) {
      queryClient.setQueryData(["me", "presence"], null);
      return;
    }

    let cancelled = false;
    let pending = false;
    const ping = async () => {
      if (cancelled || pending || document.visibilityState === "hidden") return;
      pending = true;
      try {
        if (await isBackgroundLocationActive()) return;
        const position = await new Promise<GeolocationPosition>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            timeout: 8_000,
            maximumAge: 0,
          });
        });
        if (cancelled) return;
        const status = await apiPost<PresenceStatus>("/me/presence", {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        });
        if (cancelled) return;
        queryClient.setQueryData(["me", "presence"], status);
        if (status.checked_out) {
          void queryClient.invalidateQueries({ queryKey: ["me"] });
        }
      } catch {
        /* a missed heartbeat must never break the employee portal */
      } finally {
        pending = false;
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") ping();
    };
    ping();
    const timer = window.setInterval(ping, 5_000);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [live, location?.id, queryClient, trackingConsent]);

  useEffect(() => {
    if (
      !supportsBackgroundLocation() ||
      !trackingConsent ||
      !live ||
      !location ||
      !employeeId
    ) {
      return;
    }
    let cancelled = false;
    void (async () => {
      if (
        (await isBackgroundLocationActive()) ||
        (await isBackgroundLocationManuallyStopped()) ||
        cancelled
      ) return;
      try {
        await startBackgroundLocationTracking(employeeId, false);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "تعذر بدء تتبع الموقع بالخلفية.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [employeeId, live, location?.id, trackingConsent]);

  return null;
}
