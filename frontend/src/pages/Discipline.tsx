import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Award, Clock3, MapPinOff, TrendingDown } from "lucide-react";
import { apiGet } from "@/lib/api";
import { currentMonthStr, formatIQD, formatNumber, lateLabel, monthLabel, shiftLabel } from "@/lib/format";
import type { DisciplineReport } from "@/lib/types";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState, FadeIn, LoadingBlock, PageHeader } from "@/components/shared";
import { cn } from "@/lib/utils";

const rankTone = (rank: number) =>
  rank === 1
    ? "bg-amber-100 text-amber-800"
    : rank === 2
      ? "bg-slate-200 text-slate-700"
      : rank === 3
        ? "bg-orange-100 text-orange-800"
        : "bg-slate-100 text-slate-500";

const scoreTone = (score: number) =>
  score >= 90
    ? "text-emerald-700"
    : score >= 70
      ? "text-teal-700"
      : score >= 50
        ? "text-amber-700"
        : "text-rose-700";

export default function Discipline() {
  const [month, setMonth] = useState(currentMonthStr());

  const reportQuery = useQuery({
    queryKey: ["discipline", month],
    queryFn: () => apiGet<DisciplineReport>(`/reports/discipline?month=${month}`),
  });

  const report = reportQuery.data;
  const rows = report?.rows ?? [];

  return (
    <FadeIn>
      <PageHeader
        title="تقرير الانضباط"
        description={`ترتيب الموظفين حسب الالتزام بمواعيد الدوام خلال ${monthLabel(month)}.`}
        testid="discipline-title"
        action={
          <Input
            type="month"
            value={month}
            onChange={(e) => e.target.value && setMonth(e.target.value)}
            className="w-40"
            data-testid="discipline-month-input"
          />
        }
      />

      <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-xs">
          <p className="flex items-center gap-1.5 text-xs text-slate-500">
            <Award className="h-3.5 w-3.5" />
            الأكثر انضباطاً
          </p>
          <p className="text-lg font-bold text-slate-900" data-testid="discipline-top-employee">
            {rows.find((r) => r.days_present > 0)?.name ?? "—"}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-xs">
          <p className="flex items-center gap-1.5 text-xs text-slate-500">
            <Clock3 className="h-3.5 w-3.5" />
            إجمالي دقائق التأخير
          </p>
          <p className="text-lg font-bold tabular-nums text-amber-700" data-testid="discipline-total-late">
            {formatNumber(report?.total_late_minutes ?? 0)} دقيقة
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-xs">
          <p className="flex items-center gap-1.5 text-xs text-slate-500">
            <TrendingDown className="h-3.5 w-3.5" />
            إجمالي خصم التأخير
          </p>
          <p className="text-lg font-bold tabular-nums text-rose-700" data-testid="discipline-total-deduction">
            {formatIQD(report?.total_deduction ?? 0)}
          </p>
        </div>
      </div>

      {reportQuery.isLoading ? (
        <LoadingBlock className="h-64" />
      ) : rows.length === 0 ? (
        <EmptyState
          title="لا توجد بيانات انضباط"
          description="لا يوجد موظفون نشِطون أو سجلات حضور خلال هذا الشهر."
        />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-xs">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>الترتيب</TableHead>
                <TableHead>الموظف</TableHead>
                <TableHead>وقت الدوام</TableHead>
                <TableHead>أيام الحضور</TableHead>
                <TableHead>في الوقت</TableHead>
                <TableHead>أيام التأخير</TableHead>
                <TableHead>مجموع التأخير</TableHead>
                <TableHead>مغادرة الموقع</TableHead>
                <TableHead>الخصم</TableHead>
                <TableHead>درجة الالتزام</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.employee_id} data-testid={`discipline-row-${row.employee_id}`}>
                  <TableCell>
                    <span
                      className={cn(
                        "flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold",
                        rankTone(row.rank),
                      )}
                      data-testid={`discipline-rank-${row.employee_id}`}
                    >
                      {formatNumber(row.rank)}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="block text-sm font-semibold text-slate-900">{row.name}</span>
                    <span className="block text-[11px] text-slate-500">{row.job_title}</span>
                  </TableCell>
                  <TableCell className="text-xs tabular-nums text-slate-500" dir="ltr">
                    {shiftLabel(row.shift_start, row.shift_end)}
                  </TableCell>
                  <TableCell className="text-sm tabular-nums text-slate-600">
                    {formatNumber(row.days_present)}
                  </TableCell>
                  <TableCell className="text-sm tabular-nums text-emerald-700">
                    {formatNumber(row.on_time_days)}
                  </TableCell>
                  <TableCell className="text-sm tabular-nums text-amber-700">
                    {formatNumber(row.late_days)}
                  </TableCell>
                  <TableCell className="text-sm tabular-nums text-slate-700">
                    {lateLabel(row.total_late_minutes)}
                  </TableCell>
                  <TableCell className="text-sm tabular-nums text-rose-700">
                    {row.away_minutes > 0 ? (
                      <span className="inline-flex items-center gap-1">
                        <MapPinOff className="h-3 w-3" />
                        {lateLabel(row.away_minutes)}
                      </span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm tabular-nums text-rose-700">
                    {row.deduction > 0 ? formatIQD(row.deduction) : <span className="text-slate-400">—</span>}
                  </TableCell>
                  <TableCell>
                    {row.days_present === 0 ? (
                      <span
                        className="text-xs text-slate-400"
                        data-testid={`discipline-score-${row.employee_id}`}
                      >
                        لا حضور هذا الشهر
                      </span>
                    ) : (
                    <div className="flex items-center gap-2">
                      <span
                        className={cn("text-sm font-bold tabular-nums", scoreTone(row.score))}
                        data-testid={`discipline-score-${row.employee_id}`}
                      >
                        {formatNumber(row.score)}%
                      </span>
                      <span className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-100">
                        <span
                          className="block h-full rounded-full bg-gradient-to-l from-teal-500 to-teal-600 transition-[width] duration-500"
                          style={{ width: `${row.score}%` }}
                        />
                      </span>
                    </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </FadeIn>
  );
}
