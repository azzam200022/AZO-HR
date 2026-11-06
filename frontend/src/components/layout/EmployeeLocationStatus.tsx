import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import type { AttendanceRecord, Employee, TodayResponse } from "@/lib/types";
import {
  getShiftLabel,
  getShiftState,
  getTrackingSummary,
  previousIsoDate,
  type EmployeeTrackingRow,
  type ShiftState,
  TRACKING_FRESHNESS_MINUTES,
} from "@/lib/location-tracking";

interface EmployeeLocationStatusProps {
  open: boolean;
}

const SHIFT_PRIORITY: Record<ShiftState, number> = {
  working: 0,
  upcoming: 1,
  off: 2,
  completed: 3,
};

export default function EmployeeLocationStatus({ open }: EmployeeLocationStatusProps) {
  const todayQuery = useQuery({
    queryKey: ["today"],
    queryFn: () => apiGet<TodayResponse>("/today"),
    enabled: open,
    refetchInterval: 30_000,
  });
  const employeesQuery = useQuery({
    queryKey: ["manager-location-tracking", "employees"],
    queryFn: () => apiGet<Employee[]>("/employees"),
    enabled: open,
    refetchInterval: 60_000,
  });
  const today = todayQuery.data?.today ?? "";
  const now = todayQuery.data?.now_hhmm ?? "";
  const yesterday = today ? previousIsoDate(today) : "";
  const attendanceQuery = useQuery({
    queryKey: ["manager-location-tracking", "attendance", today],
    queryFn: async () => {
      const [todayRecords, yesterdayRecords] = await Promise.all([
        apiGet<AttendanceRecord[]>(`/attendance?date=${today}`),
        apiGet<AttendanceRecord[]>(`/attendance?date=${yesterday}`),
      ]);
      return [...todayRecords, ...yesterdayRecords];
    },
    enabled: open && Boolean(today && yesterday),
    refetchInterval: 30_000,
  });

  const trackingRows = useMemo(() => {
    if (!today || !now) return [];
    const records = attendanceQuery.data ?? [];
    return (employeesQuery.data ?? [])
      .map((employee): EmployeeTrackingRow => {
        const shiftState = getShiftState(employee, today, now);
        return {
          employee,
          shiftState,
          shiftLabel: getShiftLabel(employee, shiftState),
          tracking: getTrackingSummary(employee, shiftState, records, today, now),
        };
      })
      .sort((left, right) => {
        const shiftOrder = SHIFT_PRIORITY[left.shiftState] - SHIFT_PRIORITY[right.shiftState];
        if (shiftOrder !== 0) return shiftOrder;
        const trackingOrder = Number(!left.tracking.active) - Number(!right.tracking.active);
        if (trackingOrder !== 0) return trackingOrder;
        return left.employee.name.localeCompare(right.employee.name, "ar");
      });
  }, [attendanceQuery.data, employeesQuery.data, now, today]);

  const loading =
    employeesQuery.isLoading || todayQuery.isLoading || (Boolean(today) && attendanceQuery.isLoading);
  const error = employeesQuery.isError || todayQuery.isError || attendanceQuery.isError;
  const activeCount = trackingRows.filter((row) => row.tracking.active).length;

  return (
    <section
      className="mt-3 border-t border-slate-100 pt-3"
      aria-labelledby="manager-location-tracking-title"
      data-testid="manager-location-tracking"
    >
      <div className="mb-2 flex items-center justify-between px-1">
        <h3 id="manager-location-tracking-title" className="text-sm font-bold text-slate-800">
          حالة تتبع الموقع
        </h3>
        {!loading && !error && (
          <span className="text-xs font-medium text-slate-500">
            {activeCount}/{trackingRows.length} يعمل
          </span>
        )}
      </div>
      {loading ? (
        <p className="px-1 py-2 text-xs text-slate-500" role="status">
          جارٍ تحميل حالة الموظفين…
        </p>
      ) : error ? (
        <p className="px-1 py-2 text-xs text-rose-700" role="alert">
          تعذر تحميل حالة التتبع. أعد المحاولة من زر التحديث.
        </p>
      ) : trackingRows.length === 0 ? (
        <p className="px-1 py-2 text-xs text-slate-500">لا يوجد موظفون لعرضهم.</p>
      ) : (
        <ul className="space-y-1">
          {trackingRows.map(({ employee, shiftLabel, tracking }) => (
            <li
              key={employee.id}
              data-testid={`employee-location-status-${employee.id}`}
              className="rounded-lg px-2.5 py-2 hover:bg-slate-50"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-800">{employee.name}</p>
                  <p className="mt-0.5 text-[11px] text-slate-500">{shiftLabel}</p>
                  <p className="mt-0.5 text-[11px] text-slate-500">{tracking.detail}</p>
                </div>
                <span
                  className={`flex shrink-0 items-center gap-1.5 text-[11px] font-semibold ${
                    tracking.tone === "active"
                      ? "text-emerald-700"
                      : tracking.tone === "warning"
                        ? "text-amber-700"
                        : "text-slate-500"
                  }`}
                  aria-label={tracking.label}
                >
                  <span
                    className={`h-2 w-2 rounded-full ${
                      tracking.tone === "active"
                        ? "bg-emerald-500"
                        : tracking.tone === "warning"
                          ? "bg-amber-500"
                          : "bg-slate-300"
                    }`}
                    aria-hidden="true"
                  />
                  {tracking.label}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="px-1 pt-2 text-[10px] leading-4 text-slate-400">
        يظهر التتبع نشطًا عند وصول تحديث موقع خلال آخر {TRACKING_FRESHNESS_MINUTES} دقائق.
      </p>
    </section>
  );
}
