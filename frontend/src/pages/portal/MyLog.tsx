import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarRange, Clock3 } from "lucide-react";
import { apiGet } from "@/lib/api";
import {
  durationLabel,
  fmtDate,
  formatNumber,
  lateLabel,
} from "@/lib/format";
import {
  ATTENDANCE_STATUS_LABELS,
  type AttendanceStatus,
  type EmployeeReport,
} from "@/lib/types";
import { CardSection, EmptyState, FadeIn, LoadingBlock, PageHeader } from "@/components/shared";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const STATUS_TONE: Record<AttendanceStatus, string> = {
  present: "bg-emerald-100 text-emerald-700",
  absent: "bg-rose-100 text-rose-700",
  leave: "bg-sky-100 text-sky-700",
  holiday: "bg-slate-200 text-slate-600",
};

type CycleSelection = "current" | "previous";

function CycleLog({
  report,
  isLoading,
  isError,
  label,
  testid,
}: {
  report: EmployeeReport | undefined;
  isLoading: boolean;
  isError: boolean;
  label: string;
  testid: string;
}) {
  const attendance = report?.attendance;
  const records = attendance?.records ?? [];

  return (
    <>
      {attendance && (
        <div
          className="mt-4 flex items-center gap-3 rounded-2xl border border-teal-100 bg-teal-50/70 p-4"
          data-testid={`${testid}-cycle-range`}
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-teal-100 text-teal-700">
            <CalendarRange className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-teal-900">{label}</p>
            <p className="mt-1 text-sm font-bold tabular-nums text-teal-800" dir="ltr">
              {fmtDate(attendance.cycle_start)} ← {fmtDate(attendance.cycle_end)}
            </p>
          </div>
        </div>
      )}

      <CardSection
        title={`سجل الحضور والانصراف${attendance ? ` — ${formatNumber(records.length)} يوم` : ""}`}
        testid={`${testid}-attendance-card`}
        className="mt-4"
      >
        {isLoading ? (
          <LoadingBlock className="h-48" />
        ) : isError ? (
          <EmptyState title="تعذّر تحميل السجل" description="أعد المحاولة بعد تحديث الصفحة." />
        ) : records.length === 0 ? (
          <EmptyState title="لا توجد سجلات في هذه الدورة" />
        ) : (
          <div className="space-y-2" data-testid={`${testid}-attendance-list`}>
            {[...records]
              .sort((a, b) => b.date.localeCompare(a.date))
              .map((record) => (
                <article
                  key={record.id}
                  className="rounded-xl border border-slate-100 bg-white p-3.5 shadow-xs"
                  data-testid={`${testid}-row-${record.id}`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-bold tabular-nums text-slate-800">{fmtDate(record.date)}</p>
                    <span
                      className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${STATUS_TONE[record.status]}`}
                      data-testid={`${testid}-status-${record.id}`}
                    >
                      {ATTENDANCE_STATUS_LABELS[record.status]}
                    </span>
                  </div>

                  {record.status === "present" ? (
                    <>
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        <div className="rounded-lg bg-slate-50 px-3 py-2">
                          <p className="text-[10px] text-slate-500">الحضور</p>
                          <p className="mt-1 text-sm font-bold tabular-nums text-emerald-700" dir="ltr">
                            {record.check_in || "—"}
                          </p>
                        </div>
                        <div className="rounded-lg bg-slate-50 px-3 py-2">
                          <p className="text-[10px] text-slate-500">الانصراف</p>
                          <p className="mt-1 text-sm font-bold tabular-nums text-slate-700" dir="ltr">
                            {record.check_out || "—"}
                          </p>
                        </div>
                      </div>

                      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[11px] text-slate-500">
                        <span className="inline-flex items-center gap-1">
                          <Clock3 className="h-3.5 w-3.5" />
                          مدة العمل: {durationLabel(record.check_in, record.check_out, record.away_minutes)}
                        </span>
                        {(record.late_minutes > 0 || record.away_minutes > 0) && (
                          <span className="font-semibold text-rose-700">
                            التأخير: {lateLabel(record.late_minutes + record.away_minutes)}
                          </span>
                        )}
                      </div>
                    </>
                  ) : (
                    <p className="mt-2 text-xs text-slate-500">
                      لا توجد بصمات حضور أو انصراف لهذا اليوم.
                    </p>
                  )}
                </article>
              ))}
          </div>
        )}
      </CardSection>
    </>
  );
}

/** The employee's day-by-day attendance history for the current and previous pay cycles. */
export default function MyLog() {
  const [selectedCycle, setSelectedCycle] = useState<CycleSelection>("current");
  const currentQuery = useQuery({
    queryKey: ["me", "report", "cycle", "current"],
    queryFn: () => apiGet<EmployeeReport>("/me/report?cycle=current"),
  });
  const previousQuery = useQuery({
    queryKey: ["me", "report", "cycle", "previous"],
    queryFn: () => apiGet<EmployeeReport>("/me/report?cycle=previous"),
  });

  const currentAttendance = currentQuery.data?.attendance;
  const previousAttendance = previousQuery.data?.attendance;
  const hasPreviousCycle = Boolean(
    currentAttendance &&
      previousAttendance &&
      previousAttendance.cycle_start !== currentAttendance.cycle_start &&
      previousAttendance.cycle_end >= (currentQuery.data?.employee.hire_date ?? ""),
  );
  const activeCycle =
    selectedCycle === "previous" && hasPreviousCycle ? "previous" : "current";

  return (
    <FadeIn>
      <PageHeader
        title="سجلي"
        description="سجل الحضور والانصراف للدورة الحالية والسابقة."
        testid="my-log-title"
      />

      <Tabs
        value={activeCycle}
        onValueChange={(value) => setSelectedCycle(value as CycleSelection)}
        className="mt-4"
      >
        <TabsList className="grid w-full grid-cols-2" data-testid="my-log-cycle-tabs">
          <TabsTrigger value="current" data-testid="my-log-current-tab">
            الدورة الحالية
          </TabsTrigger>
          <TabsTrigger
            value="previous"
            disabled={!hasPreviousCycle}
            data-testid="my-log-previous-tab"
          >
            الدورة السابقة
          </TabsTrigger>
        </TabsList>
        <TabsContent value="current" className="mt-0">
          <CycleLog
            report={currentQuery.data}
            isLoading={currentQuery.isLoading}
            isError={currentQuery.isError}
            label="الدورة الحالية"
            testid="my-log-current"
          />
        </TabsContent>
        <TabsContent value="previous" className="mt-0">
          {hasPreviousCycle ? (
            <CycleLog
              report={previousQuery.data}
              isLoading={previousQuery.isLoading}
              isError={previousQuery.isError}
              label="الدورة السابقة"
              testid="my-log-previous"
            />
          ) : previousQuery.isError ? (
            <p className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700">
              تعذّر تحميل سجل الدورة السابقة.
            </p>
          ) : (
            <p className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500">
              لا توجد دورة سابقة ضمن فترة عملك بعد.
            </p>
          )}
        </TabsContent>
      </Tabs>
    </FadeIn>
  );
}
