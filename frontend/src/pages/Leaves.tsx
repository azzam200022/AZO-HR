import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { apiDelete, apiGet } from "@/lib/api";
import { errorText, fmtDate, formatNumber } from "@/lib/format";
import {
  LEAVE_STATUS_LABELS,
  LEAVE_TYPE_LABELS,
  type Employee,
  type LeaveRequest,
  type LeaveStatus,
} from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  EmptyState,
  FadeIn,
  LeaveReviewButtons,
  LoadingBlock,
  PageHeader,
  StatusBadge,
} from "@/components/shared";

const TABS: { value: string; label: string }[] = [
  { value: "pending", label: "المعلقة" },
  { value: "approved", label: "المقبولة" },
  { value: "rejected", label: "المرفوضة" },
  { value: "all", label: "الكل" },
];

const STATUS_TONE: Record<LeaveStatus, "amber" | "green" | "red"> = {
  pending: "amber",
  approved: "green",
  rejected: "red",
};

export default function Leaves() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState("pending");

  const leavesQuery = useQuery({ queryKey: ["leaves"], queryFn: () => apiGet<LeaveRequest[]>("/leaves") });
  const employeesQuery = useQuery({
    queryKey: ["employees"],
    queryFn: () => apiGet<Employee[]>("/employees"),
  });
  const leaves = leavesQuery.data ?? [];
  const employees = employeesQuery.data ?? [];
  const employeeName = (id: string) => employees.find((e) => e.id === id)?.name ?? "—";

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiDelete(`/leaves/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["leaves"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success("تم حذف الطلب");
    },
    onError: (error) => toast.error(errorText(error)),
  });

  const filtered = tab === "all" ? leaves : leaves.filter((l) => l.status === tab);

  const dayCount = (leave: LeaveRequest) =>
    Math.max(1, Math.round((Date.parse(leave.end_date) - Date.parse(leave.start_date)) / 86_400_000) + 1);

  return (
    <FadeIn>
      <PageHeader
        title="إدارة الإجازات"
        description="مراجعة طلبات الإجازة والموافقة عليها أو رفضها."
        testid="leaves-title"
      />

      <Tabs value={tab} onValueChange={(value: string) => setTab(value)} className="mb-4">
        <TabsList data-testid="leaves-tabs">
          {TABS.map((t) => {
            const count = t.value === "all" ? leaves.length : leaves.filter((l) => l.status === t.value).length;
            return (
              <TabsTrigger key={t.value} value={t.value} data-testid={`leave-tab-${t.value}`}>
                {t.label}
                {count > 0 ? ` (${formatNumber(count)})` : ""}
              </TabsTrigger>
            );
          })}
        </TabsList>
      </Tabs>

      {leavesQuery.isLoading ? (
        <LoadingBlock className="h-64" />
      ) : filtered.length === 0 ? (
        <EmptyState title="لا توجد طلبات في هذه القائمة" />
      ) : (
        <div className="rounded-2xl border border-slate-200 bg-white shadow-xs">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>الموظف</TableHead>
                <TableHead>النوع</TableHead>
                <TableHead>الفترة</TableHead>
                <TableHead>الأيام</TableHead>
                <TableHead>الحالة</TableHead>
                <TableHead>ملاحظة المدير</TableHead>
                <TableHead className="text-end">إجراءات</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((leave) => (
                <TableRow key={leave.id} data-testid={`leave-row-${leave.id}`}>
                  <TableCell className="text-sm font-semibold text-slate-900">
                    {employeeName(leave.employee_id)}
                  </TableCell>
                  <TableCell className="text-sm text-slate-600">
                    {LEAVE_TYPE_LABELS[leave.leave_type]}
                  </TableCell>
                  <TableCell className="text-sm tabular-nums text-slate-600">
                    {fmtDate(leave.start_date)} ← {fmtDate(leave.end_date)}
                  </TableCell>
                  <TableCell className="text-sm tabular-nums text-slate-600">
                    {formatNumber(dayCount(leave))}
                  </TableCell>
                  <TableCell>
                    <StatusBadge
                      tone={STATUS_TONE[leave.status]}
                      label={LEAVE_STATUS_LABELS[leave.status]}
                      testid={`leave-status-${leave.id}`}
                    />
                  </TableCell>
                  <TableCell className="max-w-40 truncate text-xs text-slate-500">
                    {leave.manager_note || "—"}
                  </TableCell>
                  <TableCell className="text-end">
                    {leave.status === "pending" ? (
                      <LeaveReviewButtons
                        leave={{ ...leave, employee_name: employeeName(leave.employee_id) }}
                      />
                    ) : (
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        className="text-red-600 hover:text-red-700"
                        onClick={() => deleteMutation.mutate(leave.id)}
                        data-testid={`leave-delete-btn-${leave.id}`}
                        title="حذف"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
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