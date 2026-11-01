import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, Clock3, Fingerprint, LogOut, MapPin } from "lucide-react";
import { apiGet, apiPost } from "@/lib/api";
import {
  currentMonthStr,
  durationLabel,
  errorText,
  fmtDate,
  formatIQD,
  lateLabel,
  monthLabel,
  shiftLabel,
  todayStr,
} from "@/lib/format";
import {
  PAYROLL_STATUS_LABELS,
  type AttendanceRecord,
  type EmployeeReport,
  type PayrollItem,
  type PresenceStatus,
  type TodayResponse,
  type WorkLocation,
} from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CardSection, EmptyState, FadeIn, LoadingBlock, StatusBadge } from "@/components/shared";

/** Center tab: the punch screen. */
export default function MyAttendance() {
  const queryClient = useQueryClient();

  const locationQuery = useQuery({
    queryKey: ["me", "location"],
    queryFn: () => apiGet<WorkLocation | null>("/me/location"),
  });
  const todayQuery = useQuery({
    queryKey: ["today"],
    queryFn: () => apiGet<TodayResponse>("/today"),
    staleTime: 60_000,
  });
  const attendanceQuery = useQuery({
    queryKey: ["me", "attendance"],
    queryFn: () => apiGet<AttendanceRecord[]>("/me/attendance"),
  });
  const profileQuery = useQuery({
    queryKey: ["me", "report", currentMonthStr()],
    queryFn: () => apiGet<EmployeeReport>(`/me/report?month=${currentMonthStr()}`),
  });
  const [payslipMonth, setPayslipMonth] = useState(currentMonthStr());
  const payrollQuery = useQuery({
    queryKey: ["me", "payroll", payslipMonth],
    queryFn: () => apiGet<PayrollItem[]>(`/me/payroll?month=${payslipMonth}`),
  });

  const me = profileQuery.data?.employee;
  const shift = profileQuery.data?.attendance;
  const myLocation = locationQuery.data ?? null;
  const today = todayQuery.data?.today ?? todayStr();
  const records = attendanceQuery.data ?? [];
  const todayRecord = records.find((r) => r.date === today);
  const monthRecords = records.filter((r) => r.date.startsWith(currentMonthStr()));
  const payslip = (payrollQuery.data ?? [])[0];

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Punch times are wall-clock strings in the server timezone — anchor the clock to server
  // time so it always agrees with the stored records.
  const serverNow = todayQuery.data;
  const [fetchedAt, setFetchedAt] = useState(() => Date.now());
  useEffect(() => {
    if (todayQuery.data) setFetchedAt(Date.now());
  }, [todayQuery.data]);
  const toMinutes = (hhmm: string) => {
    const [h, m] = hhmm.split(":").map(Number);
    return h * 60 + m;
  };
  const serverNowMinutes = serverNow ? toMinutes(serverNow.now_hhmm) + (now - fetchedAt) / 60_000 : null;
  const clockLabel = (() => {
    if (serverNowMinutes === null) return "…";
    const totalSec = Math.floor(serverNowMinutes * 60);
    const hh = String(Math.floor(totalSec / 3600) % 24).padStart(2, "0");
    const mm = String(Math.floor((totalSec % 3600) / 60)).padStart(2, "0");
    const ss = String(totalSec % 60).padStart(2, "0");
    return `${hh}:${mm}:${ss}`;
  })();
  const live = !!todayRecord && !todayRecord.check_out;
  const elapsedLabel = () => {
    if (!todayRecord?.check_in || serverNowMinutes === null) return "0س 0د";
    const minutes = Math.max(0, Math.floor(serverNowMinutes - toMinutes(todayRecord.check_in)));
    return `${Math.floor(minutes / 60)}س ${minutes % 60}د`;
  };

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["me"] });

  // Presence heartbeat: while punched in at a geofenced site, report the position every
  // minute. Time spent outside the site is accrued as lateness by the backend.
  const [presence, setPresence] = useState<PresenceStatus | null>(null);
  const liveNow = !!todayRecord && !todayRecord.check_out;
  useEffect(() => {
    if (!liveNow || !myLocation || !navigator.geolocation) return;

    let cancelled = false;
    const ping = () => {
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          try {
            const status = await apiPost<PresenceStatus>("/me/presence", {
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
            });
            if (!cancelled) setPresence(status);
          } catch {
            /* a failed heartbeat must never break the screen */
          }
        },
        () => {
          /* position unavailable — skip this beat */
        },
        { enableHighAccuracy: true, timeout: 12_000, maximumAge: 30_000 },
      );
    };

    ping();
    const timer = setInterval(ping, 60_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [liveNow, myLocation]);

  const checkInMutation = useMutation({
    // The geofence is enforced server-side: 403 outside the radius, 400 without a fix.
    mutationFn: async () => {
      let coords: { lat: number; lng: number } | null = null;
      if (myLocation) {
        if (!navigator.geolocation) {
          throw new Error("المتصفح لا يدعم تحديد الموقع — لا يمكن تسجيل الحضور في موقع مقيّد");
        }
        coords = await new Promise<{ lat: number; lng: number }>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(
            (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
            () =>
              reject(new Error("تعذر تحديد موقعك — فعّل صلاحية الموقع في المتصفح ثم أعد المحاولة")),
            { enableHighAccuracy: true, timeout: 12_000 },
          );
        });
      }
      return apiPost<AttendanceRecord>("/me/check-in", coords ?? {});
    },
    onSuccess: () => {
      invalidate();
      toast.success("تم تسجيل حضورك — يوماً سعيداً!");
    },
    onError: (error) => toast.error(errorText(error)),
  });

  const checkOutMutation = useMutation({
    mutationFn: () => apiPost<AttendanceRecord>("/me/check-out"),
    onSuccess: () => {
      invalidate();
      toast.success("تم تسجيل الانصراف — أحسنت العمل");
    },
    onError: (error) => toast.error(errorText(error)),
  });

  const busy = checkInMutation.isPending || checkOutMutation.isPending;

  return (
    <FadeIn>
      <section
        className="relative overflow-hidden rounded-3xl bg-gradient-to-l from-teal-900 to-slate-900 p-6 text-center text-white shadow-lg md:p-8"
        data-testid="self-service-hero"
      >
        <div className="absolute -end-10 -top-10 h-44 w-44 rounded-full bg-teal-500/20" />
        <div className="absolute -bottom-14 start-1/4 h-40 w-40 rounded-full bg-teal-400/10" />
        <div className="relative z-10">
          <p className="text-3xl font-extrabold tabular-nums tracking-tight" data-testid="server-clock">
            {clockLabel}
          </p>
          <h2 className="mt-2 text-xl font-bold" data-testid="my-name">
            {me ? me.name : "…"}
          </h2>
          <p className="mt-0.5 text-sm text-slate-300">{me?.job_title ?? ""}</p>
          <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-teal-200" data-testid="my-work-location">
            <MapPin className="h-3.5 w-3.5" />
            {myLocation
              ? `${myLocation.name} — الحضور مسموح ضمن ${myLocation.radius_m} متراً`
              : "بدون تقييد جغرافي للحضور"}
          </p>
          {shift && (
            <p
              className="mt-1 inline-flex items-center gap-1.5 text-xs text-slate-300"
              data-testid="my-shift-label"
            >
              <Clock3 className="h-3.5 w-3.5" />
              وقت دوامي:{" "}
              <span className="font-bold tabular-nums" dir="ltr">
                {shiftLabel(shift.shift_start, shift.shift_end)}
              </span>
              <span className="text-slate-400">(سماح {shift.grace_minutes} د)</span>
            </p>
          )}

          {/* Big fingerprint punch control */}
          <div className="mt-7 flex flex-col items-center gap-4">
            {!todayRecord ? (
              <button
                type="button"
                onClick={() => checkInMutation.mutate()}
                disabled={busy || attendanceQuery.isLoading}
                className="group flex h-32 w-32 flex-col items-center justify-center gap-1 rounded-full bg-teal-500/90 text-white shadow-xl transition-all duration-200 hover:bg-teal-400 active:scale-95 disabled:opacity-60"
                data-testid="my-checkin-btn"
              >
                <Fingerprint className="h-14 w-14 transition-transform duration-200 group-hover:scale-110" strokeWidth={1.5} />
                <span className="text-xs font-bold">بصمة الحضور</span>
              </button>
            ) : live ? (
              <>
                <p className="text-2xl font-bold tabular-nums" data-testid="live-duration">
                  {elapsedLabel()}
                </p>
                <button
                  type="button"
                  onClick={() => checkOutMutation.mutate()}
                  disabled={busy}
                  className="group flex h-32 w-32 flex-col items-center justify-center gap-1 rounded-full border-2 border-white/30 bg-white/10 text-white shadow-xl transition-all duration-200 hover:bg-white/20 active:scale-95 disabled:opacity-60"
                  data-testid="my-checkout-btn"
                >
                  <LogOut className="h-12 w-12 transition-transform duration-200 group-hover:scale-110" strokeWidth={1.5} />
                  <span className="text-xs font-bold">بصمة الانصراف</span>
                </button>
              </>
            ) : (
              <span
                className="inline-flex items-center gap-2 rounded-full bg-emerald-500/20 px-5 py-3 text-sm font-semibold text-emerald-300"
                data-testid="day-complete-badge"
              >
                <CheckCircle2 className="h-5 w-5" />
                تم إكمال يوم العمل
              </span>
            )}

            {/* Live geofence state while punched in */}
            {liveNow && myLocation && presence?.tracking && (
              <div
                className={
                  presence.inside
                    ? "rounded-full bg-emerald-500/20 px-4 py-1.5 text-xs font-semibold text-emerald-200"
                    : "rounded-full bg-red-500/25 px-4 py-1.5 text-xs font-semibold text-red-200"
                }
                data-testid="presence-status"
              >
                {presence.inside
                  ? "داخل موقع العمل"
                  : `خارج موقع العمل — يُحتسب تأخيراً (${lateLabel(presence.away_minutes)})`}
              </div>
            )}

            {todayRecord && (todayRecord.late_minutes > 0 || todayRecord.away_minutes > 0) && (
              <div
                className="rounded-full bg-red-500/20 px-4 py-1.5 text-xs font-semibold text-red-200"
                data-testid="today-late-badge"
              >
                تأخير اليوم: {lateLabel(todayRecord.late_minutes + todayRecord.away_minutes)}
                {todayRecord.away_minutes > 0 && ` (منها ${lateLabel(todayRecord.away_minutes)} خارج الموقع)`}
              </div>
            )}

            {todayRecord && (
              <div
                className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1 text-xs text-teal-100"
                data-testid="today-punch-summary"
              >
                <span>
                  الحضور: <span className="font-bold tabular-nums">{todayRecord.check_in || "—"}</span>
                </span>
                <span>
                  الانصراف: <span className="font-bold tabular-nums">{todayRecord.check_out || "—"}</span>
                </span>
                {todayRecord.distance_m !== null && (
                  <span data-testid="punch-distance">
                    على بُعد <span className="font-bold tabular-nums">{Math.round(todayRecord.distance_m)}</span> م
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      </section>

      <CardSection
        title={`حضوري — ${monthLabel(currentMonthStr())}`}
        testid="my-attendance-card"
        className="mt-6"
      >
        {attendanceQuery.isLoading ? (
          <LoadingBlock className="h-48" />
        ) : monthRecords.length === 0 ? (
          <EmptyState title="لا توجد سجلات حضور هذا الشهر" />
        ) : (
          <div className="space-y-2">
            {monthRecords.map((rec) => (
              <div
                key={rec.id}
                data-testid={`my-attendance-row-${rec.id}`}
                className="flex items-center justify-between gap-2 rounded-xl border border-slate-100 bg-slate-50/60 px-4 py-2.5"
              >
                <span className="text-sm font-semibold tabular-nums text-slate-700">{fmtDate(rec.date)}</span>
                <span className="text-xs tabular-nums text-slate-500">
                  حضور {rec.check_in || "—"} • انصراف {rec.check_out || "—"}
                </span>
                <span className="text-sm font-semibold tabular-nums text-teal-700">
                  {durationLabel(rec.check_in, rec.check_out)}
                </span>
              </div>
            ))}
          </div>
        )}
      </CardSection>

      <CardSection
        title="مسير راتبي"
        testid="my-payslip-card"
        className="mt-6"
        action={
          <Input
            type="month"
            value={payslipMonth}
            onChange={(e) => e.target.value && setPayslipMonth(e.target.value)}
            className="h-8 w-36 text-xs"
            data-testid="payslip-month-input"
          />
        }
      >
        {payrollQuery.isLoading ? (
          <LoadingBlock className="h-24" />
        ) : !payslip ? (
          <EmptyState
            title={`لا يوجد مسير لشهر ${monthLabel(payslipMonth)}`}
            description="سيظهر المسير هنا بعد اعتماده من الإدارة."
          />
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-6" data-testid="payslip-breakdown">
            <div className="rounded-xl bg-slate-50 p-3 text-center">
              <p className="text-[11px] text-slate-500">الأساسي</p>
              <p className="mt-1 text-xs font-bold tabular-nums text-slate-900">{formatIQD(payslip.base_salary)}</p>
            </div>
            <div className="rounded-xl bg-slate-50 p-3 text-center">
              <p className="text-[11px] text-slate-500">البدلات</p>
              <p className="mt-1 text-xs font-bold tabular-nums text-slate-900">{formatIQD(payslip.allowances)}</p>
            </div>
            <div className="rounded-xl bg-slate-50 p-3 text-center">
              <p className="text-[11px] text-slate-500">الاستقطاعات</p>
              <p className="mt-1 text-xs font-bold tabular-nums text-red-700">{formatIQD(payslip.deductions)}</p>
            </div>
            <div className="rounded-xl bg-rose-50 p-3 text-center" data-testid="payslip-late-deduction">
              <p className="text-[11px] text-rose-700">خصم التأخير</p>
              <p className="mt-1 text-xs font-bold tabular-nums text-rose-800">
                {formatIQD(payslip.late_deduction)}
              </p>
              <p className="mt-0.5 text-[10px] text-rose-600">
                {lateLabel(payslip.late_minutes + payslip.away_minutes)}
              </p>
            </div>
            <div className="rounded-xl bg-teal-50 p-3 text-center">
              <p className="text-[11px] text-teal-700">الصافي</p>
              <p className="mt-1 text-sm font-bold tabular-nums text-teal-800">{formatIQD(payslip.net)}</p>
            </div>
            <div className="flex items-center justify-center">
              <StatusBadge
                tone={payslip.status === "paid" ? "indigo" : "amber"}
                label={PAYROLL_STATUS_LABELS[payslip.status]}
                testid="payslip-status-badge"
              />
            </div>
          </div>
        )}
      </CardSection>
    </FadeIn>
  );
}