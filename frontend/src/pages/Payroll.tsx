import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { BadgeCheck, FileSpreadsheet, Pencil } from "lucide-react";
import { apiGet, apiPatch, apiPost } from "@/lib/api";
import { currentMonthStr, errorText, formatNumber, formatSAR, monthLabel } from "@/lib/format";
import {
  PAYROLL_STATUS_LABELS,
  type Employee,
  type GenerateResult,
  type PayrollItem,
  type PayrollStatus,
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
  LoadingBlock,
  PageHeader,
  StatusBadge,
} from "@/components/shared";

export default function Payroll() {
  const queryClient = useQueryClient();
  const [month, setMonth] = useState(currentMonthStr());
  const [editing, setEditing] = useState<PayrollItem | null>(null);
  const [editForm, setEditForm] = useState({ allowances: "0", deductions: "0" });

  const itemsQuery = useQuery({
    queryKey: ["payroll", month],
    queryFn: () => apiGet<PayrollItem[]>(`/payroll?month=${month}`),
  });
  const employeesQuery = useQuery({
    queryKey: ["employees"],
    queryFn: () => apiGet<Employee[]>("/employees"),
  });
  const items = itemsQuery.data ?? [];
  const employees = employeesQuery.data ?? [];
  const employeeName = (id: string) => employees.find((e) => e.id === id)?.name ?? "—";

  const generateMutation = useMutation({
    mutationFn: () => apiPost<GenerateResult>("/payroll/generate", { month }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["payroll"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success(
        result.created > 0
          ? `تم توليد المسير — ${formatNumber(result.created)} بند جديد`
          : "المسير مولد مسبقاً لهذا الشهر",
      );
    },
    onError: (error) => toast.error(errorText(error)),
  });

  const updateMutation = useMutation({
    mutationFn: ({
      id,
      body,
    }: {
      id: string;
      body: { allowances?: number; deductions?: number; status?: PayrollStatus };
    }) => apiPatch<PayrollItem>(`/payroll/${id}`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["payroll"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      setEditing(null);
      toast.success("تم تحديث بند المسير");
    },
    onError: (error) => toast.error(errorText(error)),
  });

  const totalNet = items.reduce((sum, i) => sum + i.net, 0);
  const totalPaid = items.filter((i) => i.status === "paid").reduce((sum, i) => sum + i.net, 0);

  const openEdit = (item: PayrollItem) => {
    setEditing(item);
    setEditForm({ allowances: String(item.allowances), deductions: String(item.deductions) });
  };

  const saveEdit = () => {
    if (!editing) return;
    updateMutation.mutate({
      id: editing.id,
      body: {
        allowances: Number(editForm.allowances) || 0,
        deductions: Number(editForm.deductions) || 0,
      },
    });
  };

  return (
    <FadeIn>
      <PageHeader
        title="مسير الرواتب"
        description={`توليد واعتماد رواتب شهر ${monthLabel(month)}.`}
        testid="payroll-title"
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Input
              type="month"
              value={month}
              onChange={(e) => e.target.value && setMonth(e.target.value)}
              className="w-40"
              data-testid="payroll-month-input"
            />
            <Button
              onClick={() => generateMutation.mutate()}
              disabled={generateMutation.isPending}
              data-testid="payroll-generate-btn"
            >
              <FileSpreadsheet className="h-4 w-4" />
              توليد المسير
            </Button>
          </div>
        }
      />

      <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-xs">
          <p className="text-xs text-slate-500">عدد البنود</p>
          <p className="text-xl font-bold tabular-nums text-slate-900" data-testid="payroll-items-count">
            {formatNumber(items.length)}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-xs">
          <p className="text-xs text-slate-500">إجمالي الصافي</p>
          <p className="text-xl font-bold tabular-nums text-teal-700" data-testid="payroll-total-net">
            {formatSAR(totalNet)}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-xs">
          <p className="text-xs text-slate-500">المدفوع حتى الآن</p>
          <p className="text-xl font-bold tabular-nums text-emerald-700" data-testid="payroll-total-paid">
            {formatSAR(totalPaid)}
          </p>
        </div>
      </div>

      {itemsQuery.isLoading ? (
        <LoadingBlock className="h-64" />
      ) : items.length === 0 ? (
        <EmptyState
          title="لا يوجد مسير لهذا الشهر"
          description="اضغط «توليد المسير» لإنشاء بنود رواتب جميع الموظفين النشِطين."
        />
      ) : (
        <div className="rounded-2xl border border-slate-200 bg-white shadow-xs">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>الموظف</TableHead>
                <TableHead>الأساسي</TableHead>
                <TableHead>البدلات</TableHead>
                <TableHead>الاستقطاعات</TableHead>
                <TableHead>الصافي</TableHead>
                <TableHead>الحالة</TableHead>
                <TableHead className="text-end">إجراءات</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow key={item.id} data-testid={`payroll-row-${item.id}`}>
                  <TableCell className="text-sm font-semibold text-slate-900">
                    {employeeName(item.employee_id)}
                  </TableCell>
                  <TableCell className="text-sm tabular-nums text-slate-600">
                    {formatSAR(item.base_salary)}
                  </TableCell>
                  <TableCell className="text-sm tabular-nums text-slate-600">
                    {formatSAR(item.allowances)}
                  </TableCell>
                  <TableCell className="text-sm tabular-nums text-red-700">
                    {formatSAR(item.deductions)}
                  </TableCell>
                  <TableCell className="text-sm font-bold tabular-nums text-slate-900">
                    {formatSAR(item.net)}
                  </TableCell>
                  <TableCell>
                    <StatusBadge
                      tone={item.status === "paid" ? "indigo" : "amber"}
                      label={PAYROLL_STATUS_LABELS[item.status]}
                      testid={`payroll-status-${item.id}`}
                    />
                  </TableCell>
                  <TableCell className="text-end">
                    <div className="flex items-center justify-end gap-1.5">
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        onClick={() => openEdit(item)}
                        data-testid={`payroll-edit-btn-${item.id}`}
                        title="تعديل البدلات والاستقطاعات"
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      {item.status === "draft" && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => updateMutation.mutate({ id: item.id, body: { status: "paid" } })}
                          data-testid={`payroll-mark-paid-btn-${item.id}`}
                        >
                          <BadgeCheck className="h-4 w-4" />
                          اعتماد الدفع
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>تعديل بند: {editing ? employeeName(editing.employee_id) : ""}</DialogTitle>
            <DialogDescription>يُعاد حساب الصافي تلقائياً بعد الحفظ.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="pay-allowances">البدلات (ر.س)</Label>
              <Input
                id="pay-allowances"
                type="number"
                min={0}
                value={editForm.allowances}
                onChange={(e) => setEditForm({ ...editForm, allowances: e.target.value })}
                data-testid="payroll-allowances-input"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pay-deductions">الاستقطاعات (ر.س)</Label>
              <Input
                id="pay-deductions"
                type="number"
                min={0}
                value={editForm.deductions}
                onChange={(e) => setEditForm({ ...editForm, deductions: e.target.value })}
                data-testid="payroll-deductions-input"
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setEditing(null)} data-testid="payroll-cancel-btn">
              إلغاء
            </Button>
            <Button onClick={saveEdit} disabled={updateMutation.isPending} data-testid="payroll-save-btn">
              حفظ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </FadeIn>
  );
}