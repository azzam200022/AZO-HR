import {
  AlarmClock,
  CalendarCheck,
  CalendarClock,
  Clock3,
  MapPin,
  TrendingUp,
  Wallet,
} from "lucide-react";
import {
  durationLabel,
  fmtDate,
  formatNumber,
  formatSAR,
  lateLabel,
  monthLabel,
  shiftLabel,
} from "@/lib/format";
import { cn } from "@/lib/utils";

const AR_WEEKDAYS = ["الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت", "الأحد"];

const weekdayName = (iso: string) => {
  const d = new Date(`${iso}T00:00:00`);
  return AR_WEEKDAYS[(d.getDay() + 6) % 7];
};
import {
  LEAVE_STATUS_LABELS,
  LEAVE_TYPE_LABELS,
  type EmployeeReport,
  type LeaveStatus,
} from "@/lib/types";
import { EmptyState, LoadingBlock, StatusBadge } from "@/components/shared";
import { Input } from "@/components/ui/input";

const TONE: Record<LeaveStatus, "amber" | "green" | "red"> = {
  pending: "amber",
  approved: "green",
  rejected: "red",
};

const hours = (minutes: number) => `${Math.floor(minutes / 60)}س ${minutes % 60}د`;

function Stat({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-3">
      <p className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500">
        {icon}
        {label}
      </p>
      <p className="mt-1 text-sm font-bold tabular-nums text-slate-900">{value}</p>
    </div>
  );
}

/**
 * The employee's profile report — identical content whether the employee opens it about
 * themself (/me/report) or the manager opens it about that employee
 * (/employees/{id}/report).
 */
export default function EmployeeReportPanel({
  report,
  isLoading,
  month,
  onMonthChange,
  showSalary = false,
  testidPrefix = "report",
}: {
  report: EmployeeReport | undefined;
  isLoading: boolean;
  month: string;
  onMonthChange: (month: string) => void;
  showSalary?: boolean;
  testidPrefix?: string;
}) {
  if (isLoading) return <LoadingBlock className="h-72" />;
  if (!report) return <EmptyState title="لا يوجد تقرير" />;

  const { employee, attendance, leaves, balance, location_name } = report;
  const takenLeaves = leaves.filter((l) => l.status !== "rejected");

  return (
    <div className="space-y-5" data-testid={`${testidPrefix}-panel`}>
      {/* Identity */}
      <div className="flex items-center gap-3">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-teal-500 to-teal-700 text-lg font-bold text-white">
          {employee.name.slice(0, 1)}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-slate-900" data-testid={`${testidPrefix}-name`}>
            {employee.name}
          </p>
          <p className="truncate text-xs text-slate-500">{employee.job_title}</p>
          <p className="mt-0.5 text-[11px] tabular-nums text-slate-400">
            مباشرة العمل: {fmtDate(employee.hire_date)}
          </p>
        </div>
      </div>

      <div className="space-y-1.5 rounded-xl bg-slate-50 px-3 py-2.5 text-xs text-slate-600">
        <p className="flex items-center gap-1.5">
          <MapPin className="h-3.5 w-3.5 text-teal-600" />
          {location_name || "بدون تقييد جغرافي"}
        </p>
        <p className="flex items-center gap-1.5" data-testid={`${testidPrefix}-shift`}>
          <Clock3 className="h-3.5 w-3.5 text-teal-600" />
          وقت الدوام: <span className="font-semibold tabular-nums" dir="ltr">{shiftLabel(attendance.shift_start, attendance.shift_end)}</span>
          <span className="text-slate-400">(سماح {attendance.grace_minutes} د)</span>
        </p>
        {showSalary && (
          <p className="flex items-center gap-1.5">
            <Wallet className="h-3.5 w-3.5 text-teal-600" />
            الأساسي {formatSAR(employee.base_salary)} • البدلات {formatSAR(employee.allowances)}
          </p>
        )}
      </div>

      {/* Leave balance for the hire-date cycle */}
      <div
        className="rounded-xl border border-teal-100 bg-teal-50/70 p-3.5"
        data-testid={`${testidPrefix}-balance`}
      >
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-semibold text-teal-900">رصيد إجازات الدورة الحالية</p>
          <span className="text-sm font-extrabold tabular-nums text-teal-800">
            {formatNumber(balance.remaining)} / {formatNumber(balance.quota)}
          </span>
        </div>
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-teal-200/60">
          <div
            className="h-full rounded-full bg-teal-600 transition-all duration-300"
            style={{
              width: `${balance.quota > 0 ? Math.min(100, (balance.used / balance.quota) * 100) : 100}%`,
            }}
          />
        </div>
        <p className="mt-2 text-[11px] tabular-nums text-teal-800/80">
          الدورة: {fmtDate(balance.cycle_start)} ← {fmtDate(balance.cycle_end)} • المستخدم{" "}
          {formatNumber(balance.used)}
        </p>
      </div>

      {/* Monthly attendance report */}
      <div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-bold text-slate-800">تقرير حضور {monthLabel(month)}</p>
          <Input
            type="month"
            value={month}
            onChange={(e) => e.target.value && onMonthChange(e.target.value)}
            className="h-8 w-36 text-xs"
            data-testid={`${testidPrefix}-month-input`}
          />
        </div>
        <div className="mt-2.5 grid grid-cols-2 gap-2">
          <Stat
            label="أيام الحضور"
            value={formatNumber(attendance.days_present)}
            icon={<CalendarCheck className="h-3 w-3" />}
          />
          <Stat
            label="أيام مكتملة"
            value={formatNumber(attendance.days_complete)}
            icon={<TrendingUp className="h-3 w-3" />}
          />
          <Stat
            label="إجمالي ساعات العمل"
            value={hours(attendance.total_minutes)}
            icon={<Clock3 className="h-3 w-3" />}
          />
          <Stat
            label="متوسط وقت الحضور"
            value={attendance.avg_check_in || "—"}
            icon={<CalendarClock className="h-3 w-3" />}
          />
          <Stat
            label="أيام التأخير"
            value={formatNumber(attendance.late_days)}
            icon={<AlarmClock className="h-3 w-3" />}
          />
          <Stat
            label="إجمالي التأخير"
            value={lateLabel(attendance.total_late_minutes)}
            icon={<AlarmClock className="h-3 w-3" />}
          />
        </div>
        {attendance.total_away_minutes > 0 && (
          <p
            className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-800"
            data-testid={`${testidPrefix}-away-note`}
          >
            يشمل الإجمالي {lateLabel(attendance.total_away_minutes)} احتُسبت نتيجة مغادرة موقع
            العمل أثناء الدوام.
          </p>
        )}
        {/* Full daily log — every day of the month with its exact punch times, not just the
            summary above. */}
        <p className="mt-3 text-[11px] font-bold text-slate-700">
          السجل اليومي الكامل ({formatNumber(attendance.records.length)} يوم)
        </p>
        {attendance.records.length === 0 ? (
          <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
            لا توجد سجلات حضور في هذا الشهر.
          </p>
        ) : (
          <div
            className="mt-2 overflow-hidden rounded-xl border border-slate-100"
            data-testid={`${testidPrefix}-attendance-list`}
          >
            <table className="w-full text-[11px]">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="px-2.5 py-1.5 text-start font-semibold">اليوم</th>
                  <th className="px-2 py-1.5 text-start font-semibold">التاريخ</th>
                  <th className="px-2 py-1.5 text-center font-semibold">الحضور</th>
                  <th className="px-2 py-1.5 text-center font-semibold">الانصراف</th>
                  <th className="px-2 py-1.5 text-center font-semibold">المدة</th>
                  <th className="px-2 py-1.5 text-center font-semibold">التأخير</th>
                </tr>
              </thead>
              <tbody>
                {[...attendance.records]
                  .sort((a, b) => a.date.localeCompare(b.date))
                  .map((rec) => (
                    <tr
                      key={rec.id}
                      className="border-t border-slate-100 even:bg-slate-50/50"
                      data-testid={`${testidPrefix}-attendance-${rec.id}`}
                    >
                      <td className="px-2.5 py-1.5 font-medium text-slate-600">{weekdayName(rec.date)}</td>
                      <td className="px-2 py-1.5 font-semibold tabular-nums text-slate-700">
                        {fmtDate(rec.date)}
                      </td>
                      <td className="px-2 py-1.5 text-center font-bold tabular-nums text-emerald-700">
                        {rec.check_in || "—"}
                      </td>
                      <td className="px-2 py-1.5 text-center font-bold tabular-nums text-slate-600">
                        {rec.check_out || "—"}
                      </td>
                      <td className="px-2 py-1.5 text-center tabular-nums text-teal-700">
                        {durationLabel(rec.check_in, rec.check_out)}
                      </td>
                      <td
                        className={cn(
                          "px-2 py-1.5 text-center font-semibold tabular-nums",
                          rec.late_minutes + rec.away_minutes > 0 ? "text-red-700" : "text-slate-400",
                        )}
                      >
                        {lateLabel(rec.late_minutes + rec.away_minutes)}
                        {rec.away_minutes > 0 && (
                          <span className="block text-[10px] font-normal text-amber-700">
                            منها {lateLabel(rec.away_minutes)} خارج الموقع
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Leaves taken */}
      <div>
        <p className="text-xs font-bold text-slate-800">
          تقرير الإجازات ({formatNumber(takenLeaves.length)})
        </p>
        {leaves.length === 0 ? (
          <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
            لا توجد إجازات مسجّلة.
          </p>
        ) : (
          <div className="mt-2 space-y-1.5" data-testid={`${testidPrefix}-leaves-list`}>
            {leaves.map((leave) => (
              <div
                key={leave.id}
                className="rounded-lg border border-slate-100 px-2.5 py-1.5"
                data-testid={`${testidPrefix}-leave-${leave.id}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold text-slate-700">
                    {LEAVE_TYPE_LABELS[leave.leave_type]}
                  </span>
                  <StatusBadge tone={TONE[leave.status]} label={LEAVE_STATUS_LABELS[leave.status]} />
                </div>
                <p className="mt-1 text-[11px] tabular-nums text-slate-500">
                  {fmtDate(leave.start_date)} ← {fmtDate(leave.end_date)}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}