import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost } from "@/lib/api";
import type { AttendanceRecord, PresenceStatus, TodayResponse, WorkLocation } from "@/lib/types";

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

  const today = todayQuery.data?.today;
  const todayRecord = attendanceQuery.data?.find((record) => record.date === today);
  const live = !!todayRecord && !todayRecord.check_out;
  const location = locationQuery.data ?? null;

  useEffect(() => {
    if (!live || !location || !navigator.geolocation) {
      queryClient.setQueryData(["me", "presence"], null);
      return;
    }

    let cancelled = false;
    let pending = false;
    const ping = () => {
      if (cancelled || pending || document.visibilityState === "hidden") return;
      pending = true;
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          if (cancelled) {
            pending = false;
            return;
          }
          try {
            const status = await apiPost<PresenceStatus>("/me/presence", {
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
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
        },
        () => {
          pending = false;
        },
        { enableHighAccuracy: true, timeout: 12_000, maximumAge: 30_000 },
      );
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") ping();
    };
    ping();
    const timer = window.setInterval(ping, 60_000);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [live, location?.id, queryClient]);

  return null;
}
