import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CalendarDays, UserCheck, Users, Wallet } from "lucide-react";
import { apiGet } from "@/lib/api";
import { fmtDate, formatNumber, formatSAR } from "@/lib/format";
import {
  LEAVE_STATUS_LABELS,
  LEAVE_TYPE_LABELS,
  type DashboardStats,
  type Employee,
  type LeaveRequest,
  type LeaveStatus,
} from "@/lib/types";
import {
  CardSection,
  EmptyState,
  FadeIn,
  KpiCard,
  LeaveReviewButtons,
  LoadingBlock,
  PageHeader,
} from "@/components/shared";

const LEAVE_COLORS: Record<LeaveStatus, string> = {
  pending: "#D97706",
  approved: "#16A34A",
  rejected: "#DC2626",
};

export default function Dashboard() {
  const statsQuery = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => apiGet<DashboardStats>("/dashboard"),
  });
  const employeesQuery = useQuery({
    queryKey: ["employees"],
    queryFn: () => apiGet<Employee[]>("/employees"),
  });
  const pendingQuery = useQuery({
    queryKey: ["leaves", "pending"],
    queryFn: () => apiGet<LeaveRequest[]>("/leaves?status=pending"),
  });

  const stats = statsQuery.data;
  const employees = employeesQuery.data ?? [];
  const pending = pendingQuery.data ?? [];

  const trend = (stats?.attendance_trend ?? []).map((p) => ({
    ...p,
    label: `${Number(p.date.slice(8))}/${Number(p.date.slice(5, 7))}`,
  }));
  const leaveData = stats
    ? (Object.entries(stats.leave_breakdown) as [LeaveStatus, number][]).map(([key, value]) => ({
        key,
        name: LEAVE_STATUS_LABELS[key],
        value,
      }))
    : [];

  const employeeName = (id: string) => employees.find((e) => e.id === id)?.name ?? "—";

  return (
    <FadeIn>
      <PageHeader
        title="لوحة تحكم المدير"
        description="نظرة شاملة على القوى العاملة والحضور والطلبات."
        testid="dashboard-title"
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 md:gap-6">
        <KpiCard
          testid="kpi-employees"
          label="إجمالي الموظفين"
          value={stats ? formatNumber(stats.total_employees) : "—"}
          hint={stats ? `${formatNumber(stats.active_employees)} نشِط` : undefined}
          icon={<Users className="h-5 w-5" />}
        />
        <KpiCard
          testid="kpi-present-today"
          label="الحضور اليوم"
          value={stats ? formatNumber(stats.present_today) : "—"}
          icon={<UserCheck className="h-5 w-5" />}
        />
        <KpiCard
          testid="kpi-pending-leaves"
          label="طلبات معلقة"
          value={stats ? formatNumber(stats.pending_leaves) : "—"}
          icon={<CalendarDays className="h-5 w-5" />}
        />
        <KpiCard
          testid="kpi-payroll-total"
          label="صافي رواتب الشهر"
          value={stats ? formatSAR(stats.payroll_total) : "—"}
          hint={stats ? `مسير ${stats.payroll_month}` : undefined}
          icon={<Wallet className="h-5 w-5" />}
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="space-y-6 lg:col-span-8">
          <CardSection title="اتجاه الحضور — آخر 7 أيام" testid="attendance-trend-card">
            {statsQuery.isLoading ? (
              <LoadingBlock className="h-56" />
            ) : (
              <div className="h-56" dir="ltr">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={trend}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#64748B" }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#64748B" }} width={28} />
                    <Tooltip cursor={{ fill: "#F1F5F9" }} />
                    <Bar dataKey="present" name="الحاضرون" fill="#0D9488" radius={[6, 6, 0, 0]} maxBarSize={36} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardSection>

          <CardSection title="طلبات إجازة بانتظار المراجعة" testid="pending-leaves-card">
            {pendingQuery.isLoading ? (
              <LoadingBlock className="h-32" />
            ) : pending.length === 0 ? (
              <EmptyState title="لا توجد طلبات معلقة" description="تمت مراجعة جميع الطلبات." />
            ) : (
              <div className="space-y-3">
                {pending.slice(0, 4).map((leave) => (
                  <div
                    key={leave.id}
                    data-testid={`pending-leave-${leave.id}`}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50/60 p-3.5"
                  >
                    <div>
                      <p className="text-sm font-semibold text-slate-900">
                        {employeeName(leave.employee_id)}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {LEAVE_TYPE_LABELS[leave.leave_type]} • {fmtDate(leave.start_date)} ←{" "}
                        {fmtDate(leave.end_date)}
                      </p>
                    </div>
                    {employees.length > 0 && (
                      <LeaveReviewButtons
                        leave={{ ...leave, employee_name: employeeName(leave.employee_id) }}
                      />
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardSection>
        </div>

        <div className="space-y-6 lg:col-span-4">
          <CardSection title="حالات الإجازات" testid="leave-breakdown-card">
            {statsQuery.isLoading ? (
              <LoadingBlock className="h-52" />
            ) : (
              <div className="h-52" dir="ltr">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={leaveData}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={48}
                      outerRadius={78}
                      paddingAngle={3}
                      stroke="none"
                    >
                      {leaveData.map((entry) => (
                        <Cell key={entry.key} fill={LEAVE_COLORS[entry.key]} />
                      ))}
                    </Pie>
                    <Tooltip />
                    <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardSection>

          <CardSection
            title="أحدث الموظفين"
            testid="roster-card"
            action={
              <Link
                to="/employees"
                className="text-xs font-semibold text-teal-600 hover:text-teal-700"
                data-testid="roster-view-all-link"
              >
                عرض الكل
              </Link>
            }
          >
            <div className="space-y-2.5">
              {employees.slice(0, 6).map((emp) => (
                <div key={emp.id} data-testid={`roster-employee-${emp.id}`} className="flex items-center gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-teal-50 text-sm font-bold text-teal-700">
                    {emp.name.slice(0, 1)}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-900">{emp.name}</p>
                    <p className="truncate text-xs text-slate-500">{emp.job_title}</p>
                  </div>
                </div>
              ))}
              {!employeesQuery.isLoading && employees.length === 0 && (
                <EmptyState title="لا يوجد موظفون بعد" />
              )}
            </div>
          </CardSection>
        </div>
      </div>
    </FadeIn>
  );
}