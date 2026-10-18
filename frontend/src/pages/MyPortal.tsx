import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CalendarPlus, CheckCircle2, LogIn, LogOut, MapPin } from "lucide-react";
import { apiGet, apiPost } from "@/lib/api";
import {
  currentMonthStr,
  durationLabel,
  errorText,
  fmtDate,
  formatNumber,
  formatSAR,
  monthLabel,
  todayStr,
} from "@/lib/format";
import {
  LEAVE_STATUS_LABELS,
  LEAVE_TYPE_LABELS,
  PAYROLL_STATUS_LABELS,
  type AttendanceRecord,
  type EmployeeReport,
  type LeaveBalance,
  type LeaveRequest,
  type LeaveType,
  type PayrollItem,
  type TodayResponse,
  type WorkLocation,
} from "@/lib/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  CardSection,
  EmptyState,
  FadeIn,
  LoadingBlock,
  StatusBadge,
} from "@/components/shared";
import EmployeeReportPanel from "@/components/EmployeeReportPanel";

// Every request here hits /me/* — the backend resolves "me" from the session cookie, so an
// employee can never read or write another employee's records.
export default function MyPortal() {
  const queryClient = useQueryClient();
  const [reportMonth, setReportMonth] = useState(currentMonthStr());

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
  const leavesQuery = useQuery({
    queryKey: ["me", "leaves"],
    queryFn: () => apiGet<LeaveRequest[]>("/me/leaves"),
  });
  const balanceQuery = useQuery({
    queryKey: ["me", "leave-balance"],
    queryFn: () => apiGet<LeaveBalance>("/me/leave-balance"),
  });
  const reportQuery = useQuery({
    queryKey: ["me", "report", reportMonth],
    queryFn: () => apiGet<EmployeeReport>(`/me/report?month=${reportMonth}`),
  });
  const [payslipMonth, setPayslipMonth] = useState(currentMonthStr());
  const payrollQuery = useQuery({
    queryKey: ["me", "payroll", payslipMonth],
    queryFn: () => apiGet<PayrollItem[]>(`/me/payroll?month=${payslipMonth}`),
  });

  const me = reportQuery.data?.employee;
  const myLocation = locationQuery.data ?? null;
  const today = todayQuery.data?.today ?? todayStr();
  const records = attendanceQuery.data ?? [];
  const myLeaves = leavesQuery.data ?? [];
  const balance = balanceQuery.data;
  const todayRecord = records.find((r) => r.date === today);
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

  const [leaveOpen, setLeaveOpen] = useState(false);
  const [leaveForm, setLeaveForm] = useState<{
    leave_type: LeaveType;
    start_date: string;
    end_date: string;
    reason: string;
  }>({ leave_type: "annual", start_date: todayStr(), end_date: todayStr(), reason: "" });

  const leaveMutation = useMutation({
    mutationFn: () => apiPost<LeaveRequest>("/me/leaves", leaveForm),
    onSuccess: () => {
      invalidate();
      setLeaveOpen(false);
      toast.success("تم إرسال طلب الإجازة — بانتظار موافقة المدير");
    },
    onError: (error) => toast.error(errorText(error)),
  });

  const quotaExhausted = !!balance && balance.remaining <= 0;

  const submitLeave = () => {
    if (leaveForm.end_date < leaveForm.start_date) {
      toast.error("تاريخ النهاية يجب أن يكون بعد تاريخ البداية");
      return;
    }
    leaveMutation.mutate();
  };

  return (
    <FadeIn>
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 md:text-3xl" data-testid="my-portal-title">
          بوابة الموظف
        </h1>
        <p className="mt-1 text-sm text-slate-500">سجّل حضورك، تابع إجازاتك، واطّلع على ملفك الشخصي.</p>
      </div>

      {/* RTL layout: leaves on the right, attendance in the middle, profile on the left */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* ——— RIGHT: leaves ——— */}
        <section className="space-y-6 lg:col-span-3" data-testid="portal-leaves-column">
          <CardSection title="إجازاتي" testid="my-leaves-card">
            <div className="space-y-4">
              {balanceQuery.isLoading ? (
                <LoadingBlock className="h-20" />
              ) : balance ? (
                <div className="rounded-xl border border-teal-100 bg-teal-50/70 p-3" data-testid="leave-balance-box">
                  <div className="flex items-baseline justify-between">
                    <span className="text-xs font-semibold text-teal-900">المتبقي هذه الدورة</span>
                    <span className="text-lg font-extrabold tabular-nums text-teal-800" data-testid="leave-remaining">
                      {formatNumber(balance.remaining)} / {formatNumber(balance.quota)}
                    </span>
                  </div>
                  <p className="mt-1.5 text-[11px] tabular-nums text-teal-800/80">
                    {fmtDate(balance.cycle_start)} ← {fmtDate(balance.cycle_end)}
                  </p>
                </div>
              ) : null}

              <Button
                className="w-full"
                onClick={() => setLeaveOpen(true)}
                disabled={quotaExhausted}
                data-testid="my-leave-request-btn"
              >
                <CalendarPlus className="h-4 w-4" />
                {quotaExhausted ? "نفد رصيد الدورة" : "طلب إجازة"}
              </Button>
              {quotaExhausted && (
                <p className="rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-800" data-testid="quota-exhausted-note">
                  استنفدت عدد الإجازات المسموح ({formatNumber(balance!.quota)}) خلال دورتك الحالية.
                  يمكنك التقديم بعد {fmtDate(balance!.cycle_end)}.
                </p>
              )}

              {leavesQuery.isLoading ? (
                <LoadingBlock className="h-40" />
              ) : myLeaves.length === 0 ? (
                <EmptyState title="لا توجد طلبات" description="قدّم طلبك الأول." />
              ) : (
                <div className="space-y-2">
                  {myLeaves.slice(0, 5).map((leave) => (
                    <div
                      key={leave.id}
                      data-testid={`my-leave-row-${leave.id}`}
                      className="rounded-xl border border-slate-100 bg-slate-50/60 px-3 py-2.5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-slate-800">
                          {LEAVE_TYPE_LABELS[leave.leave_type]}
                        </span>
                        <StatusBadge
                          tone={leave.status === "pending" ? "amber" : leave.status === "approved" ? "green" : "red"}
                          label={LEAVE_STATUS_LABELS[leave.status]}
                          testid={`my-leave-status-${leave.id}`}
                        />
                      </div>
                      <p className="mt-1 text-[11px] tabular-nums text-slate-500">
                        {fmtDate(leave.start_date)} ← {fmtDate(leave.end_date)}
                      </p>
                      {leave.manager_note && (
                        <p className="mt-1 text-[11px] text-slate-500">ملاحظة: {leave.manager_note}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </CardSection>
        </section>

        {/* ——— CENTER: attendance ——— */}
        <section className="space-y-6 lg:col-span-6" data-testid="portal-attendance-column">
          <div
            className="relative overflow-hidden rounded-2xl bg-gradient-to-l from-teal-900 to-slate-900 p-6 text-center text-white shadow-lg md:p-8"
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

              <div className="mt-6 flex flex-col items-center gap-4">
                {!todayRecord ? (
                  <Button
                    size="lg"
                    onClick={() => checkInMutation.mutate()}
                    disabled={checkInMutation.isPending || attendanceQuery.isLoading}
                    className="bg-teal-500 px-8 text-white hover:bg-teal-600"
                    data-testid="my-checkin-btn"
                  >
                    <LogIn className="h-4 w-4" />
                    تسجيل الحضور
                  </Button>
                ) : live ? (
                  <>
                    <p className="text-2xl font-bold tabular-nums" data-testid="live-duration">
                      {elapsedLabel()}
                    </p>
                    <Button
                      size="lg"
                      variant="outline"
                      onClick={() => checkOutMutation.mutate()}
                      disabled={checkOutMutation.isPending}
                      className="border-white/30 bg-white/10 px-8 text-white hover:bg-white/20"
                      data-testid="my-checkout-btn"
                    >
                      <LogOut className="h-4 w-4" />
                      تسجيل الانصراف
                    </Button>
                  </>
                ) : (
                  <span
                    className="inline-flex items-center gap-2 rounded-full bg-emerald-500/20 px-5 py-2.5 text-sm font-semibold text-emerald-300"
                    data-testid="day-complete-badge"
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    تم إكمال يوم العمل
                  </span>
                )}

                {todayRecord && (
                  <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1 text-xs text-teal-100" data-testid="today-punch-summary">
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
          </div>

          <CardSection title={`حضوري — ${monthLabel(currentMonthStr())}`} testid="my-attendance-card">
            {attendanceQuery.isLoading ? (
              <LoadingBlock className="h-48" />
            ) : records.filter((r) => r.date.startsWith(currentMonthStr())).length === 0 ? (
              <EmptyState title="لا توجد سجلات حضور هذا الشهر" />
            ) : (
              <div className="space-y-2">
                {records
                  .filter((r) => r.date.startsWith(currentMonthStr()))
                  .map((rec) => (
                    <div
                      key={rec.id}
                      data-testid={`my-attendance-row-${rec.id}`}
                      className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50/60 px-4 py-2.5"
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
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-5" data-testid="payslip-breakdown">
                <div className="rounded-xl bg-slate-50 p-3 text-center">
                  <p className="text-[11px] text-slate-500">الأساسي</p>
                  <p className="mt-1 text-xs font-bold tabular-nums text-slate-900">{formatSAR(payslip.base_salary)}</p>
                </div>
                <div className="rounded-xl bg-slate-50 p-3 text-center">
                  <p className="text-[11px] text-slate-500">البدلات</p>
                  <p className="mt-1 text-xs font-bold tabular-nums text-slate-900">{formatSAR(payslip.allowances)}</p>
                </div>
                <div className="rounded-xl bg-slate-50 p-3 text-center">
                  <p className="text-[11px] text-slate-500">الاستقطاعات</p>
                  <p className="mt-1 text-xs font-bold tabular-nums text-red-700">{formatSAR(payslip.deductions)}</p>
                </div>
                <div className="rounded-xl bg-teal-50 p-3 text-center">
                  <p className="text-[11px] text-teal-700">الصافي</p>
                  <p className="mt-1 text-sm font-bold tabular-nums text-teal-800">{formatSAR(payslip.net)}</p>
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
        </section>

        {/* ——— LEFT: personal profile & reports ——— */}
        <section className="lg:col-span-3" data-testid="portal-profile-column">
          <CardSection title="ملفي الشخصي" testid="my-profile-card">
            <EmployeeReportPanel
              report={reportQuery.data}
              isLoading={reportQuery.isLoading}
              month={reportMonth}
              onMonthChange={setReportMonth}
              testidPrefix="my-report"
            />
          </CardSection>
        </section>
      </div>

      <Dialog open={leaveOpen} onOpenChange={setLeaveOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>طلب إجازة جديد</DialogTitle>
            <DialogDescription>
              {balance
                ? `المتبقي ${formatNumber(balance.remaining)} من ${formatNumber(balance.quota)} خلال دورتك الحالية (${fmtDate(balance.cycle_start)} ← ${fmtDate(balance.cycle_end)}).`
                : "سيصل طلبك إلى المدير للمراجعة."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>نوع الإجازة</Label>
              <Select
                value={leaveForm.leave_type}
                onValueChange={(v: string) => setLeaveForm({ ...leaveForm, leave_type: v as LeaveType })}
              >
                <SelectTrigger data-testid="leave-type-select">
                  <SelectValue>{(v: string) => LEAVE_TYPE_LABELS[v as LeaveType]}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="annual">سنوية</SelectItem>
                  <SelectItem value="sick">مرضية</SelectItem>
                  <SelectItem value="unpaid">بدون راتب</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="leave-start">من تاريخ</Label>
                <Input
                  id="leave-start"
                  type="date"
                  value={leaveForm.start_date}
                  onChange={(e) => setLeaveForm({ ...leaveForm, start_date: e.target.value })}
                  data-testid="leave-start-input"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="leave-end">إلى تاريخ</Label>
                <Input
                  id="leave-end"
                  type="date"
                  value={leaveForm.end_date}
                  onChange={(e) => setLeaveForm({ ...leaveForm, end_date: e.target.value })}
                  data-testid="leave-end-input"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="leave-reason">السبب</Label>
              <Textarea
                id="leave-reason"
                rows={3}
                value={leaveForm.reason}
                onChange={(e) => setLeaveForm({ ...leaveForm, reason: e.target.value })}
                placeholder="اكتب سبب الإجازة (اختياري)"
                data-testid="leave-reason-input"
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setLeaveOpen(false)} data-testid="leave-cancel-btn">
              إلغاء
            </Button>
            <Button onClick={submitLeave} disabled={leaveMutation.isPending} data-testid="leave-submit-btn">
              إرسال الطلب
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </FadeIn>
  );
}