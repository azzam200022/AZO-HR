import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { MapPin, Pencil, Plus, Search, Trash2, UserRoundCheck, UserRoundX } from "lucide-react";
import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from "@/lib/api";
import { errorText, fmtDate, formatSAR, todayStr } from "@/lib/format";
import { EMPLOYEE_STATUS_LABELS, type Employee, type EmployeeStatus, type WorkLocation } from "@/lib/types";
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
  PageHeader,
  StatusBadge,
} from "@/components/shared";

interface EmployeeForm {
  name: string;
  job_title: string;
  email: string;
  phone: string;
  base_salary: string;
  allowances: string;
  hire_date: string;
  status: EmployeeStatus;
  location_id: string;
}

const EMPTY_FORM: EmployeeForm = {
  name: "",
  job_title: "",
  email: "",
  phone: "",
  base_salary: "",
  allowances: "0",
  hire_date: todayStr(),
  status: "active",
  location_id: "",
};

export default function Employees() {
  const queryClient = useQueryClient();
  const { data: employees = [], isLoading } = useQuery({
    queryKey: ["employees"],
    queryFn: () => apiGet<Employee[]>("/employees"),
  });
  const { data: locations = [] } = useQuery({
    queryKey: ["locations"],
    queryFn: () => apiGet<WorkLocation[]>("/locations"),
  });
  const locationName = (id: string) => locations.find((l) => l.id === id)?.name ?? "";

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Employee | null>(null);
  const [form, setForm] = useState<EmployeeForm>(EMPTY_FORM);
  const [deleting, setDeleting] = useState<Employee | null>(null);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["employees"] });
    queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    queryClient.invalidateQueries({ queryKey: ["payroll"] });
  };

  const saveMutation = useMutation({
    mutationFn: (payload: EmployeeForm) => {
      const body = {
        ...payload,
        base_salary: Number(payload.base_salary) || 0,
        allowances: Number(payload.allowances) || 0,
      };
      return editing
        ? apiPut<Employee>(`/employees/${editing.id}`, body)
        : apiPost<Employee>("/employees", body);
    },
    onSuccess: () => {
      invalidate();
      setDialogOpen(false);
      toast.success(editing ? "تم تحديث بيانات الموظف" : "تمت إضافة الموظف بنجاح");
      setEditing(null);
      setForm(EMPTY_FORM);
    },
    onError: (error) => toast.error(errorText(error)),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: EmployeeStatus }) =>
      apiPatch<Employee>(`/employees/${id}`, { status }),
    onSuccess: () => {
      invalidate();
      toast.success("تم تحديث حالة الموظف");
    },
    onError: (error) => toast.error(errorText(error)),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiDelete(`/employees/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries(); // employee delete cascades to attendance/leaves/payroll
      setDeleting(null);
      toast.success("تم حذف الموظف وجميع سجلاته");
    },
    onError: (error) => toast.error(errorText(error)),
  });

  const filtered = useMemo(
    () =>
      employees.filter((emp) => {
        const q = search.trim();
        const matches =
          !q || emp.name.includes(q) || emp.job_title.includes(q) || emp.email.includes(q);
        return matches && (statusFilter === "all" || emp.status === statusFilter);
      }),
    [employees, search, statusFilter],
  );

  const openAdd = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  };

  const openEdit = (emp: Employee) => {
    setEditing(emp);
    setForm({
      name: emp.name,
      job_title: emp.job_title,
      email: emp.email,
      phone: emp.phone,
      base_salary: String(emp.base_salary),
      allowances: String(emp.allowances),
      hire_date: emp.hire_date,
      status: emp.status,
      location_id: emp.location_id,
    });
    setDialogOpen(true);
  };

  const submit = () => {
    if (!form.name.trim() || !form.job_title.trim() || !form.hire_date) {
      toast.error("الاسم والمسمى الوظيفي وتاريخ التعيين حقول مطلوبة");
      return;
    }
    if (!form.base_salary || Number(form.base_salary) <= 0) {
      toast.error("أدخل راتباً أساسياً صحيحاً");
      return;
    }
    saveMutation.mutate(form);
  };

  return (
    <FadeIn>
      <PageHeader
        title="إدارة الموظفين"
        description="إضافة وتحديث ملفات الموظفين ورواتبهم."
        testid="employees-title"
        action={
          <Button onClick={openAdd} data-testid="add-employee-btn">
            <Plus className="h-4 w-4" />
            إضافة موظف
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative min-w-56 flex-1">
          <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ابحث بالاسم أو المسمى الوظيفي أو البريد..."
            className="ps-9"
            data-testid="employee-search-input"
          />
        </div>
        <Select value={statusFilter} onValueChange={(value: string) => setStatusFilter(value)}>
          <SelectTrigger className="w-40" data-testid="employee-status-filter">
            <SelectValue>
              {(v: string) =>
                v === "all" ? "كل الحالات" : EMPLOYEE_STATUS_LABELS[v as EmployeeStatus]
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">كل الحالات</SelectItem>
            <SelectItem value="active">نشِط</SelectItem>
            <SelectItem value="inactive">موقوف</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="h-64 animate-pulse rounded-2xl border border-slate-200 bg-slate-100" />
      ) : filtered.length === 0 ? (
        <EmptyState title="لا يوجد موظفون" description="ابدأ بإضافة موظف جديد." />
      ) : (
        <div className="rounded-2xl border border-slate-200 bg-white shadow-xs">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>الموظف</TableHead>
                <TableHead>المسمى الوظيفي</TableHead>
                <TableHead>موقع العمل</TableHead>
                <TableHead>تاريخ التعيين</TableHead>
                <TableHead>الراتب الأساسي</TableHead>
                <TableHead>البدلات</TableHead>
                <TableHead>الحالة</TableHead>
                <TableHead className="text-end">إجراءات</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((emp) => (
                <TableRow key={emp.id} data-testid={`employee-row-${emp.id}`}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-teal-50 text-sm font-bold text-teal-700">
                        {emp.name.slice(0, 1)}
                      </span>
                      <div>
                        <p className="text-sm font-semibold text-slate-900">{emp.name}</p>
                        <p className="text-xs text-slate-500">{emp.email || "—"}</p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-slate-600">{emp.job_title}</TableCell>
                  <TableCell className="text-xs" data-testid={`employee-location-${emp.id}`}>
                    {emp.location_id ? (
                      <span className="inline-flex items-center gap-1 font-medium text-slate-700">
                        <MapPin className="h-3.5 w-3.5 text-teal-600" />
                        {locationName(emp.location_id) || "موقع محذوف"}
                      </span>
                    ) : (
                      <span className="text-slate-400">بدون تقييد</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm tabular-nums text-slate-600">
                    {fmtDate(emp.hire_date)}
                  </TableCell>
                  <TableCell className="text-sm font-semibold tabular-nums text-slate-900">
                    {formatSAR(emp.base_salary)}
                  </TableCell>
                  <TableCell className="text-sm tabular-nums text-slate-600">
                    {formatSAR(emp.allowances)}
                  </TableCell>
                  <TableCell>
                    <StatusBadge
                      tone={emp.status === "active" ? "green" : "slate"}
                      label={EMPLOYEE_STATUS_LABELS[emp.status]}
                      testid={`employee-status-${emp.id}`}
                    />
                  </TableCell>
                  <TableCell className="text-end">
                    <div className="flex items-center justify-end gap-1.5">
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        onClick={() => openEdit(emp)}
                        data-testid={`edit-employee-btn-${emp.id}`}
                        title="تعديل"
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        onClick={() =>
                          toggleMutation.mutate({
                            id: emp.id,
                            status: emp.status === "active" ? "inactive" : "active",
                          })
                        }
                        data-testid={`toggle-employee-status-${emp.id}`}
                        title={emp.status === "active" ? "إيقاف" : "تنشيط"}
                      >
                        {emp.status === "active" ? (
                          <UserRoundX className="h-4 w-4" />
                        ) : (
                          <UserRoundCheck className="h-4 w-4" />
                        )}
                      </Button>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        className="text-red-600 hover:text-red-700"
                        onClick={() => setDeleting(emp)}
                        data-testid={`delete-employee-btn-${emp.id}`}
                        title="حذف"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing ? `تعديل بيانات: ${editing.name}` : "إضافة موظف جديد"}</DialogTitle>
            <DialogDescription>أدخل بيانات الموظف الوظيفية والمالية.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="emp-name">الاسم الكامل *</Label>
              <Input
                id="emp-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="مثال: محمد العبدالله"
                data-testid="employee-name-input"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="emp-job">المسمى الوظيفي *</Label>
              <Input
                id="emp-job"
                value={form.job_title}
                onChange={(e) => setForm({ ...form, job_title: e.target.value })}
                placeholder="مثال: مهندس برمجيات"
                data-testid="employee-job-title-input"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="emp-email">البريد الإلكتروني</Label>
              <Input
                id="emp-email"
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="name@company.sa"
                data-testid="employee-email-input"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="emp-phone">رقم الجوال</Label>
              <Input
                id="emp-phone"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                placeholder="05xxxxxxxx"
                data-testid="employee-phone-input"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="emp-salary">الراتب الأساسي (ر.س) *</Label>
              <Input
                id="emp-salary"
                type="number"
                min={0}
                value={form.base_salary}
                onChange={(e) => setForm({ ...form, base_salary: e.target.value })}
                data-testid="employee-salary-input"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="emp-allowances">البدلات (ر.س)</Label>
              <Input
                id="emp-allowances"
                type="number"
                min={0}
                value={form.allowances}
                onChange={(e) => setForm({ ...form, allowances: e.target.value })}
                data-testid="employee-allowances-input"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="emp-hire-date">تاريخ التعيين *</Label>
              <Input
                id="emp-hire-date"
                type="date"
                value={form.hire_date}
                onChange={(e) => setForm({ ...form, hire_date: e.target.value })}
                data-testid="employee-hire-date-input"
              />
            </div>
            <div className="space-y-2">
              <Label>الحالة</Label>
              <Select
                value={form.status}
                onValueChange={(value: string) =>
                  setForm({ ...form, status: value as EmployeeStatus })
                }
              >
                <SelectTrigger data-testid="employee-status-select">
                  <SelectValue>{(v: string) => EMPLOYEE_STATUS_LABELS[v as EmployeeStatus]}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">نشِط</SelectItem>
                  <SelectItem value="inactive">موقوف</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>موقع العمل (تقييد الحضور)</Label>
              <Select
                value={form.location_id || "none"}
                onValueChange={(value: string) =>
                  setForm({ ...form, location_id: value === "none" ? "" : value })
                }
              >
                <SelectTrigger data-testid="employee-location-select">
                  <SelectValue>
                    {(v: string) => (v === "none" ? "بدون تقييد جغرافي" : locationName(v as string))}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">بدون تقييد جغرافي</SelectItem>
                  {locations.map((loc) => (
                    <SelectItem key={loc.id} value={loc.id}>
                      {loc.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDialogOpen(false)} data-testid="employee-cancel-btn">
              إلغاء
            </Button>
            <Button onClick={submit} disabled={saveMutation.isPending} data-testid="employee-save-btn">
              {editing ? "حفظ التعديلات" : "إضافة الموظف"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDeleteDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`حذف الموظف: ${deleting?.name ?? ""}`}
        description="سيتم حذف الموظف وجميع سجلات حضوره وإجازاته ورواتب. لا يمكن التراجع عن هذا الإجراء."
        onConfirm={() => deleting && deleteMutation.mutate(deleting.id)}
        testId="confirm-delete-employee-btn"
      />
    </FadeIn>
  );
}