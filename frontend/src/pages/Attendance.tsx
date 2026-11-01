import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { apiDelete, apiGet, apiPost } from "@/lib/api";
import { durationLabel, errorText, fmtDate, formatNumber, lateLabel, todayStr } from "@/lib/format";
import type { AttendanceRecord, Employee } from "@/lib/types";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ConfirmDeleteDialog,
  EmptyState,
  FadeIn,
  LoadingBlock,
  PageHeader,
} from "@/components/shared";

export default function Attendance() {
  const queryClient = useQueryClient();
  const [dateFilter, setDateFilter] = useState("");
  const [employeeFilter, setEmployeeFilter] = useState("all");
  const [addOpen, setAddOpen] = useState(false);
  const [deleting, setDeleting] = useState<AttendanceRecord | null>(null);
  const [form, setForm] = useState({
    employee_id: "",
    date: todayStr(),
    check_in: "09:00",
    check_out: "17:00",
  });

  const employeesQuery = useQuery({
    queryKey: ["employees"],
    queryFn: () => apiGet<Employee[]>("/employees"),
  });
  const employees = employeesQuery.data ?? [];

  const recordsQuery = useQuery({
    queryKey: ["attendance", dateFilter, employeeFilter],
    queryFn: () => {
      const params = new URLSearchParams();
      if (dateFilter) params.set("date", dateFilter);
      if (employeeFilter !== "all") params.set("employee_id", employeeFilter);
      return apiGet<AttendanceRecord[]>(`/attendance?${params.toString()}`);
    },
  });
  const records = recordsQuery.data ?? [];

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["attendance"] });
    queryClient.invalidateQueries({ queryKey: ["dashboard"] });
  };

  const addMutation = useMutation({
    mutationFn: () => apiPost<AttendanceRecord>("/attendance", form),
    onSuccess: () => {
      invalidate();
      setAddOpen(false);
      toast.success("تمت إضافة سجل الحضور");
    },
    onError: (error) => toast.error(errorText(error)),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiDelete(`/attendance/${id}`),
    onSuccess: () => {
      invalidate();
      setDeleting(null);
      toast.success("تم حذف السجل");
    },
    onError: (error) => toast.error(errorText(error)),
  });

  const employeeName = (id: string) => employees.find((e) => e.id === id)?.name ?? "—";
  const activeCount = employees.filter((e) => e.status === "active").length;
  // The attendance rate only means something for a single day — without a date filter the
  // list spans many days and the ratio would exceed 100%.
  const rate =
    dateFilter && activeCount > 0
      ? Math.round((records.filter((r) => r.date === dateFilter).length / activeCount) * 100)
      : null;

  const openAdd = () => {
    const firstActive = employees.find((e) => e.status === "active");
    setForm((f) => ({ ...f, employee_id: firstActive?.id ?? "" }));
    setAddOpen(true);
  };

  return (
    <FadeIn>
      <PageHeader
        title="سجل الحضور والانصراف"
        description="متابعة بصمات الحضور اليومية وإضافة سجلات يدوية."
        testid="attendance-title"
        action={
          <Button onClick={openAdd} data-testid="add-attendance-btn">
            <Plus className="h-4 w-4" />
            تسجيل يدوي
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label className="text-xs text-slate-500">التاريخ</Label>
          <Input
            type="date"
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value)}
            className="w-44"
            data-testid="attendance-date-input"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-slate-500">الموظف</Label>
          <Select value={employeeFilter} onValueChange={(value: string) => setEmployeeFilter(value)}>
            <SelectTrigger className="w-48" data-testid="attendance-employee-filter">
              <SelectValue>
                {(v: string) => (v === "all" ? "كل الموظفين" : employeeName(v))}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">كل الموظفين</SelectItem>
              {employees.map((emp) => (
                <SelectItem key={emp.id} value={emp.id}>
                  {emp.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex gap-3 ms-auto">
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-center shadow-xs">
            <p className="text-xs text-slate-500">السجلات المعروضة</p>
            <p className="text-lg font-bold tabular-nums text-slate-900" data-testid="attendance-shown-count">
              {formatNumber(records.length)}
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-center shadow-xs">
            <p className="text-xs text-slate-500">نسبة حضور اليوم المحدد</p>
            <p className="text-lg font-bold tabular-nums text-teal-700" data-testid="attendance-rate">
              {rate === null ? "—" : `${formatNumber(rate)}%`}
            </p>
          </div>
        </div>
      </div>

      {recordsQuery.isLoading ? (
        <LoadingBlock className="h-64" />
      ) : records.length === 0 ? (
        <EmptyState title="لا توجد سجلات حضور" description="جرّب تغيير الفلتر أو أضف سجلاً يدوياً." />
      ) : (
        <div className="rounded-2xl border border-slate-200 bg-white shadow-xs">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>الموظف</TableHead>
                <TableHead>التاريخ</TableHead>
                <TableHead>الحضور</TableHead>
                <TableHead>الانصراف</TableHead>
                <TableHead>مدة العمل</TableHead>
                <TableHead>التأخير</TableHead>
                <TableHead className="text-end">إجراءات</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {records.map((rec) => (
                <TableRow key={rec.id} data-testid={`attendance-row-${rec.id}`}>
                  <TableCell className="text-sm font-semibold text-slate-900">
                    {employeeName(rec.employee_id)}
                  </TableCell>
                  <TableCell className="text-sm tabular-nums text-slate-600">{fmtDate(rec.date)}</TableCell>
                  <TableCell className="text-sm tabular-nums text-emerald-700">{rec.check_in || "—"}</TableCell>
                  <TableCell className="text-sm tabular-nums text-slate-600">{rec.check_out || "—"}</TableCell>
                  <TableCell className="text-sm tabular-nums text-slate-600">
                    {durationLabel(rec.check_in, rec.check_out)}
                  </TableCell>
                  <TableCell data-testid={`attendance-late-${rec.id}`}>
                    {rec.late_minutes + rec.away_minutes > 0 ? (
                      <span className="text-sm font-semibold tabular-nums text-red-700">
                        {lateLabel(rec.late_minutes + rec.away_minutes)}
                        {rec.away_minutes > 0 && (
                          <span className="block text-[10px] font-normal text-amber-700">
                            منها {lateLabel(rec.away_minutes)} خارج الموقع
                          </span>
                        )}
                      </span>
                    ) : (
                      <span className="text-xs text-emerald-700">في الوقت</span>
                    )}
                  </TableCell>
                  <TableCell className="text-end">
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      className="text-red-600 hover:text-red-700"
                      onClick={() => setDeleting(rec)}
                      data-testid={`delete-attendance-btn-${rec.id}`}
                      title="حذف"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>تسجيل حضور يدوي</DialogTitle>
            <DialogDescription>أضف سجل حضور لموظف في تاريخ محدد.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>الموظف</Label>
              <Select
                value={form.employee_id}
                onValueChange={(value: string) => setForm({ ...form, employee_id: value })}
              >
                <SelectTrigger data-testid="manual-employee-select">
                  <SelectValue>{(v: string) => (v ? employeeName(v) : "اختر الموظف")}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {employees.map((emp) => (
                    <SelectItem key={emp.id} value={emp.id}>
                      {emp.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="att-date">التاريخ</Label>
                <Input
                  id="att-date"
                  type="date"
                  value={form.date}
                  onChange={(e) => setForm({ ...form, date: e.target.value })}
                  data-testid="manual-date-input"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="att-in">الحضور</Label>
                <Input
                  id="att-in"
                  type="time"
                  value={form.check_in}
                  onChange={(e) => setForm({ ...form, check_in: e.target.value })}
                  data-testid="manual-checkin-input"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="att-out">الانصراف</Label>
                <Input
                  id="att-out"
                  type="time"
                  value={form.check_out}
                  onChange={(e) => setForm({ ...form, check_out: e.target.value })}
                  data-testid="manual-checkout-input"
                />
              </div>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setAddOpen(false)} data-testid="manual-cancel-btn">
              إلغاء
            </Button>
            <Button
              onClick={() => addMutation.mutate()}
              disabled={addMutation.isPending || !form.employee_id}
              data-testid="manual-save-btn"
            >
              إضافة السجل
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDeleteDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="حذف سجل الحضور"
        description={`سيتم حذف سجل ${deleting ? employeeName(deleting.employee_id) : ""} بتاريخ ${
          deleting ? fmtDate(deleting.date) : ""
        }.`}
        onConfirm={() => deleting && deleteMutation.mutate(deleting.id)}
        testId="confirm-delete-attendance-btn"
      />
    </FadeIn>
  );
}