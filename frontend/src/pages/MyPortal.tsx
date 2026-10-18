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
  formatSAR,
  monthLabel,
  todayStr,
} from "@/lib/format";
import {
  LEAVE_STATUS_LABELS,
  LEAVE_TYPE_LABELS,
  PAYROLL_STATUS_LABELS,
  type AttendanceRecord,
  type Employee,
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

// Every request here hits /me/* — the backend resolves "me" from the session cookie, so an
// employee can never read or write another employee's records.
export default function MyPortal() {
  const queryClient = useQueryClient();

  const profileQuery = useQuery({
    queryKey: ["me", "profile"],
    queryFn: () => apiGet<Employee>("/me/profile"),
  });
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
  const [payslipMonth, setPayslipMonth] = useState(currentMonthStr());
  const payrollQuery = useQuery({
    queryKey: ["me", "payroll", payslipMonth],
    queryFn: () => apiGet<PayrollItem[]>(`/me/payroll?month=${payslipMonth}`),
  });

  const me = profileQuery.data;
  const myLocation = locationQuery.data ?? null;
  const today = todayQuery.data?.today ?? todayStr();
  const records = attendanceQuery.data ?? [];
  const myLeaves = leavesQuery.data ?? [];
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
        <p className="mt-1 text-sm text-slate-500">سجّل حضورك، تابع إجازاتك، واطّلع على مسير راتبك.</p>
      </div>

      <section
        className="relative overflow-hidden rounded-2xl bg-gradient-to-l from-teal-900 to-slate-900 p-6 text-white shadow-lg md:p-8"
        data-testid="self-service-hero"
      >
        <div className="absolute -end-10 -top-10 h-44 w-44 rounded-full bg-teal-500/20" />
        <div className="absolute -bottom-14 start-1/3 h-40 w-40 rounded-full bg-teal-400/10" />
        <div className="relative z-10 flex flex-wrap items-center justify-between gap-6">
          <div>
            <p className="text-xs font-medium tabular-nums text-teal-200" data-testid="server-clock">
              {clockLabel}
            </p>
            <h2 className="mt-1 text-2xl font-bold" data-testid="my-name">
              {me ? me.name : "…"}
            </h2>
            <p className="mt-1 text-sm text-slate-300">{me?.job_title ?? ""}</p>
            <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-teal-200" data-testid="my-work-location">
              <MapPin className="h-3.5 w-3.5" />
              {myLocation
                ? `${myLocation.name} — الحضور مسموح ضمن ${myLocation.radius_m} متراً`
                : "بدون تقييد جغرافي للحضور"}
            </p>
          </div>
          <div className="flex items-center gap-5">
            {todayRecord && (
              <div className="text-start text-xs text-teal-100" data-testid="today-punch-summary">
                <p>
                  الحضور: <span className="font-bold tabular-nums">{todayRecord.check_in || "—"}</span>
                </p>
                <p className="mt-1">
                  الانصراف: <span className="font-bold tabular-nums">{todayRecord.check_out || "—"}</span>
                </p>
                {todayRecord.distance_m !== null && (
                  <p className="mt-1" data-testid="punch-distance">
                    على بُعد <span className="font-bold tabular-nums">{Math.round(todayRecord.distance_m)}</span> متراً من الموقع
                  </p>
                )}
                {live && (
                  <p className="mt-2 text-lg font-bold tabular-nums text-white" data-testid="live-duration">
                    {elapsedLabel()}
                  </p>
                )}
              </div>
            )}
            {!todayRecord ? (
              <Button
                onClick={() => checkInMutation.mutate()}
                disabled={checkInMutation.isPending || attendanceQuery.isLoading}
                className="bg-teal-500 text-white hover:bg-teal-600"
                data-testid="my-checkin-btn"
              >
                <LogIn className="h-4 w-4" />
                تسجيل الحضور
              </Button>
            ) : live ? (
              <Button
                variant="outline"
                onClick={() => checkOutMutation.mutate()}
                disabled={checkOutMutation.isPending}
                className="border-white/30 bg-white/10 text-white hover:bg-white/20"
                data-testid="my-checkout-btn"
              >
                <LogOut className="h-4 w-4" />
                تسجيل الانصراف
              </Button>
            ) : (
              <span
                className="inline-flex items-center gap-2 rounded-full bg-emerald-500/20 px-4 py-2 text-sm font-semibold text-emerald-300"
                data-testid="day-complete-badge"
              >
                <CheckCircle2 className="h-4 w-4" />
                تم إكمال يوم العمل
              </span>
            )}
          </div>
        </div>
      </section>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <CardSection title={`حضوري — ${monthLabel(currentMonthStr())}`} testid="my-attendance-card" className="lg:col-span-2">
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
          title="إجازاتي"
          testid="my-leaves-card"
          action={
            <Button size="sm" onClick={() => setLeaveOpen(true)} data-testid="my-leave-request-btn">
              <CalendarPlus className="h-4 w-4" />
              طلب إجازة
            </Button>
          }
        >
          {leavesQuery.isLoading ? (
            <LoadingBlock className="h-48" />
          ) : myLeaves.length === 0 ? (
            <EmptyState title="لا توجد طلبات إجازة" description="قدّم طلبك الأول." />
          ) : (
            <div className="space-y-2">
              {myLeaves.slice(0, 6).map((leave) => (
                <div
                  key={leave.id}
                  data-testid={`my-leave-row-${leave.id}`}
                  className="rounded-xl border border-slate-100 bg-slate-50/60 px-4 py-2.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-slate-800">
                      {LEAVE_TYPE_LABELS[leave.leave_type]}
                    </span>
                    <StatusBadge
                      tone={leave.status === "pending" ? "amber" : leave.status === "approved" ? "green" : "red"}
                      label={LEAVE_STATUS_LABELS[leave.status]}
                      testid={`my-leave-status-${leave.id}`}
                    />
                  </div>
                  <p className="mt-1 text-xs tabular-nums text-slate-500">
                    {fmtDate(leave.start_date)} ← {fmtDate(leave.end_date)}
                  </p>
                  {leave.manager_note && (
                    <p className="mt-1 text-xs text-slate-500">ملاحظة المدير: {leave.manager_note}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardSection>
      </div>

      <CardSection
        title="مسير راتبي"
        testid="my-payslip-card"
        className="mt-6"
        action={
          <Input
            type="month"
            value={payslipMonth}
            onChange={(e) => e.target.value && setPayslipMonth(e.target.value)}
            className="w-40"
            data-testid="payslip-month-input"
          />
        }
      >
        {payrollQuery.isLoading ? (
          <LoadingBlock className="h-32" />
        ) : !payslip ? (
          <EmptyState
            title={`لا يوجد مسير لشهر ${monthLabel(payslipMonth)}`}
            description="سيظهر المسير هنا بعد اعتماده من الإدارة."
          />
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-5" data-testid="payslip-breakdown">
            <div className="rounded-xl bg-slate-50 p-4 text-center">
              <p className="text-xs text-slate-500">الأساسي</p>
              <p className="mt-1 text-sm font-bold tabular-nums text-slate-900">{formatSAR(payslip.base_salary)}</p>
            </div>
            <div className="rounded-xl bg-slate-50 p-4 text-center">
              <p className="text-xs text-slate-500">البدلات</p>
              <p className="mt-1 text-sm font-bold tabular-nums text-slate-900">{formatSAR(payslip.allowances)}</p>
            </div>
            <div className="rounded-xl bg-slate-50 p-4 text-center">
              <p className="text-xs text-slate-500">الاستقطاعات</p>
              <p className="mt-1 text-sm font-bold tabular-nums text-red-700">{formatSAR(payslip.deductions)}</p>
            </div>
            <div className="rounded-xl bg-teal-50 p-4 text-center">
              <p className="text-xs text-teal-700">الصافي</p>
              <p className="mt-1 text-base font-bold tabular-nums text-teal-800">{formatSAR(payslip.net)}</p>
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

      <Dialog open={leaveOpen} onOpenChange={setLeaveOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>طلب إجازة جديد</DialogTitle>
            <DialogDescription>سيصل طلبك إلى المدير للمراجعة.</DialogDescription>
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