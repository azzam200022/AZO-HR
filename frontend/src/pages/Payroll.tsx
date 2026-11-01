import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { BadgeCheck, FileSpreadsheet, Gift, Pencil, Trash2 } from "lucide-react";
import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api";
import {
  currentMonthStr,
  errorText,
  fmtDate,
  formatIQD,
  formatNumber,
  lateLabel,
  monthLabel,
} from "@/lib/format";
import {
  PAYROLL_STATUS_LABELS,
  type Adjustment,
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
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
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
  const [adjusting, setAdjusting] = useState<PayrollItem | null>(null);
  const [adjustForm, setAdjustForm] = useState<{ kind: "bonus" | "deduction"; amount: string; reason: string }>(
    { kind: "bonus", amount: "", reason: "" },
  );
  const [paying, setPaying] = useState<PayrollItem | null>(null);

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
          ? `تم توليد المسير — ${formatNumber(result.created)} بند جديد، وتحديث خصم التأخير لـ ${formatNumber(result.updated)} بند`
          : `تم تحديث خصم التأخير لـ ${formatNumber(result.updated)} بند في المسير`,
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

  const adjustmentsQuery = useQuery({
    queryKey: ["adjustments", adjusting?.employee_id ?? ""],
    queryFn: () => apiGet<Adjustment[]>(`/adjustments?employee_id=${adjusting?.employee_id}`),
    enabled: adjusting !== null,
  });

  const adjustMutation = useMutation({
    mutationFn: () =>
      apiPost<Adjustment>("/adjustments", {
        employee_id: adjusting?.employee_id,
        kind: adjustForm.kind,
        amount: Number(adjustForm.amount) || 0,
        reason: adjustForm.reason,
      }),
    onSuccess: async () => {
      setAdjustForm({ kind: "bonus", amount: "", reason: "" });
      queryClient.invalidateQueries({ queryKey: ["adjustments"] });
      // The payslip must reflect the new figure immediately.
      await apiPost<GenerateResult>("/payroll/generate", { month });
      queryClient.invalidateQueries({ queryKey: ["payroll"] });
      toast.success("تمت إضافة البند وتحديث المسير");
    },
    onError: (error) => toast.error(errorText(error)),
  });

  const deleteAdjustMutation = useMutation({
    mutationFn: (id: string) => apiDelete<{ deleted: boolean }>(`/adjustments/${id}`),
    onSuccess: async () => {
      queryClient.invalidateQueries({ queryKey: ["adjustments"] });
      await apiPost<GenerateResult>("/payroll/generate", { month });
      queryClient.invalidateQueries({ queryKey: ["payroll"] });
      toast.success("تم حذف البند");
    },
    onError: (error) => toast.error(errorText(error)),
  });

  const openAdjust = (item: PayrollItem) => {
    setAdjusting(item);
    setAdjustForm({ kind: "bonus", amount: "", reason: "" });
  };

  const submitAdjust = () => {
    if (!adjustForm.reason.trim()) {
      toast.error("اذكر سبب الحافز أو الخصم");
      return;
    }
    if (!adjustForm.amount || Number(adjustForm.amount) <= 0) {
      toast.error("أدخل مبلغاً صحيحاً");
      return;
    }
    adjustMutation.mutate();
  };

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
        description={`توليد واعتماد رواتب شهر ${monthLabel(month)} — خصم التأخير ومغادرة الموقع يُحتسب تلقائياً.`}
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
              توليد وتحديث المسير
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
            {formatIQD(totalNet)}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-xs">
          <p className="text-xs text-slate-500">المدفوع حتى الآن</p>
          <p className="text-xl font-bold tabular-nums text-emerald-700" data-testid="payroll-total-paid">
            {formatIQD(totalPaid)}
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
                <TableHead>الدورة</TableHead>
                <TableHead>الاستقطاعات</TableHead>
                <TableHead>حوافز / خصومات</TableHead>
                <TableHead>دقائق التأخير</TableHead>
                <TableHead>خصم التأخير</TableHead>
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
                    {formatIQD(item.base_salary)}
                  </TableCell>
                  <TableCell className="text-sm tabular-nums text-slate-600">
                    {formatIQD(item.allowances)}
                  </TableCell>
                  <TableCell
                    className="text-[11px] tabular-nums text-slate-500"
                    dir="ltr"
                    data-testid={`payroll-cycle-${item.id}`}
                  >
                    {item.cycle_start ? `${fmtDate(item.cycle_start)} ← ${fmtDate(item.cycle_end)}` : "—"}
                  </TableCell>
                  <TableCell className="text-sm tabular-nums text-red-700">
                    {formatIQD(item.deductions)}
                  </TableCell>
                  <TableCell className="text-xs tabular-nums" data-testid={`payroll-adjustments-${item.id}`}>
                    {item.bonus_total > 0 && (
                      <span className="block text-emerald-700">+{formatIQD(item.bonus_total)}</span>
                    )}
                    {item.adjustment_deductions > 0 && (
                      <span className="block text-rose-700">−{formatIQD(item.adjustment_deductions)}</span>
                    )}
                    {item.bonus_total === 0 && item.adjustment_deductions === 0 && (
                      <span className="text-slate-400">—</span>
                    )}
                  </TableCell>
                  <TableCell
                    className="text-sm tabular-nums text-slate-600"
                    data-testid={`payroll-late-minutes-${item.id}`}
                  >
                    {item.late_minutes + item.away_minutes > 0 ? (
                      <span className="inline-flex flex-col">
                        <span className="text-amber-700">{lateLabel(item.late_minutes + item.away_minutes)}</span>
                        {item.away_minutes > 0 && (
                          <span className="text-[10px] text-rose-600">
                            منها {lateLabel(item.away_minutes)} خارج الموقع
                          </span>
                        )}
                      </span>
                    ) : (
                      <span className="text-emerald-700">في الوقت</span>
                    )}
                  </TableCell>
                  <TableCell
                    className="text-sm tabular-nums text-rose-700"
                    data-testid={`payroll-late-deduction-${item.id}`}
                  >
                    {item.late_deduction > 0 ? formatIQD(item.late_deduction) : <span className="text-slate-400">—</span>}
                  </TableCell>
                  <TableCell className="text-sm font-bold tabular-nums text-slate-900">
                    {formatIQD(item.net)}
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
                        onClick={() => openAdjust(item)}
                        data-testid={`payroll-adjust-btn-${item.id}`}
                        title="إضافة حافز أو خصم بسبب"
                      >
                        <Gift className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        onClick={() => openEdit(item)}
                        data-testid={`payroll-edit-btn-${item.id}`}
                        title="تعديل البدلات والاستقطاعات"
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      {item.status === "draft" ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setPaying(item)}
                          data-testid={`payroll-mark-paid-btn-${item.id}`}
                        >
                          <BadgeCheck className="h-4 w-4" />
                          اعتماد الدفع
                        </Button>
                      ) : (
                        <span
                          className="text-[11px] text-slate-500"
                          data-testid={`payroll-archived-${item.id}`}
                        >
                          تمت التسوية • أُرشف {formatNumber(item.archived_days)} يوم حضور
                        </span>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Bonus / deduction with a mandatory reason */}
      <Dialog open={adjusting !== null} onOpenChange={(open) => !open && setAdjusting(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              حوافز وخصومات: {adjusting ? employeeName(adjusting.employee_id) : ""}
            </DialogTitle>
            <DialogDescription>
              كل بند يحتاج سبباً مذكوراً، ويظهر للموظف في مسير راتبه.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="adj-kind">النوع *</Label>
              <select
                id="adj-kind"
                value={adjustForm.kind}
                onChange={(e) =>
                  setAdjustForm({ ...adjustForm, kind: e.target.value as "bonus" | "deduction" })
                }
                className="h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
                data-testid="adjustment-kind-select"
              >
                <option value="bonus">حافز (زيادة)</option>
                <option value="deduction">خصم</option>
              </select>
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="adj-amount">المبلغ (د.ع) *</Label>
              <Input
                id="adj-amount"
                type="number"
                min={1}
                value={adjustForm.amount}
                onChange={(e) => setAdjustForm({ ...adjustForm, amount: e.target.value })}
                data-testid="adjustment-amount-input"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="adj-reason">السبب *</Label>
            <Textarea
              id="adj-reason"
              rows={2}
              value={adjustForm.reason}
              onChange={(e) => setAdjustForm({ ...adjustForm, reason: e.target.value })}
              placeholder="مثال: مكافأة إنجاز مشروع / خصم مخالفة إدارية"
              data-testid="adjustment-reason-input"
            />
          </div>

          <div className="max-h-40 space-y-1.5 overflow-y-auto" data-testid="adjustment-history">
            {(adjustmentsQuery.data ?? []).length === 0 ? (
              <p className="text-xs text-slate-500">لا توجد بنود سابقة لهذا الموظف.</p>
            ) : (
              (adjustmentsQuery.data ?? []).map((a) => (
                <div
                  key={a.id}
                  className="flex items-start justify-between gap-2 rounded-lg bg-slate-50 px-2.5 py-2"
                  data-testid={`adjustment-row-${a.id}`}
                >
                  <span className="min-w-0">
                    <span
                      className={cn(
                        "block text-xs font-bold tabular-nums",
                        a.kind === "bonus" ? "text-emerald-700" : "text-rose-700",
                      )}
                    >
                      {a.kind === "bonus" ? "+" : "−"}
                      {formatIQD(a.amount)}
                    </span>
                    <span className="block text-[11px] text-slate-600">{a.reason}</span>
                    <span className="block text-[10px] text-slate-400">
                      {fmtDate(a.date)}
                      {a.settled && " • تمت تسويته"}
                    </span>
                  </span>
                  {!a.settled && (
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      onClick={() => deleteAdjustMutation.mutate(a.id)}
                      data-testid={`adjustment-delete-btn-${a.id}`}
                      title="حذف البند"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              ))
            )}
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setAdjusting(null)} data-testid="adjustment-close-btn">
              إغلاق
            </Button>
            <Button
              onClick={submitAdjust}
              disabled={adjustMutation.isPending}
              data-testid="adjustment-save-btn"
            >
              إضافة البند
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Paying settles the cycle — say so before it happens */}
      <Dialog open={paying !== null} onOpenChange={(open) => !open && setPaying(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>اعتماد دفع الراتب</DialogTitle>
            <DialogDescription>
              {paying
                ? paying.cycle_start
                  ? `سيتم اعتماد راتب ${employeeName(paying.employee_id)} للدورة ${fmtDate(
                      paying.cycle_start,
                    )} ← ${fmtDate(paying.cycle_end)}.`
                  : `سيتم اعتماد راتب ${employeeName(paying.employee_id)}.`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <p className="rounded-lg bg-amber-50 px-3 py-2.5 text-xs leading-relaxed text-amber-800">
            بعد الاعتماد تُؤرشف سجلات حضور هذه الدورة وتختفي من السجل الجاري، وتُقفل حوافزها
            وخصوماتها. الدورة التالية تبدأ من الصفر، ويبقى تقرير الدورة المؤرشفة قابلاً للعرض.
          </p>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setPaying(null)} data-testid="pay-cancel-btn">
              إلغاء
            </Button>
            <Button
              onClick={() =>
                paying &&
                updateMutation.mutate({ id: paying.id, body: { status: "paid" } }, { onSuccess: () => setPaying(null) })
              }
              disabled={updateMutation.isPending}
              data-testid="pay-confirm-btn"
            >
              <BadgeCheck className="h-4 w-4" />
              اعتماد وتسوية الدورة
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>تعديل بند: {editing ? employeeName(editing.employee_id) : ""}</DialogTitle>
            <DialogDescription>
              يُعاد حساب الصافي تلقائياً بعد الحفظ. خصم التأخير محسوب من سجل الحضور ولا يُعدَّل يدوياً.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="pay-allowances">البدلات (د.ع)</Label>
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
              <Label htmlFor="pay-deductions">الاستقطاعات (د.ع)</Label>
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