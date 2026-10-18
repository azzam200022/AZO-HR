import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CalendarPlus } from "lucide-react";
import { apiGet, apiPost } from "@/lib/api";
import { errorText, fmtDate, formatNumber, todayStr } from "@/lib/format";
import {
  LEAVE_STATUS_LABELS,
  LEAVE_TYPE_LABELS,
  type LeaveBalance,
  type LeaveRequest,
  type LeaveType,
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  CardSection,
  EmptyState,
  FadeIn,
  LoadingBlock,
  PageHeader,
  StatusBadge,
} from "@/components/shared";

/** Right tab: leave balance, requesting, and history. */
export default function MyLeaves() {
  const queryClient = useQueryClient();
  const leavesQuery = useQuery({
    queryKey: ["me", "leaves"],
    queryFn: () => apiGet<LeaveRequest[]>("/me/leaves"),
  });
  const balanceQuery = useQuery({
    queryKey: ["me", "leave-balance"],
    queryFn: () => apiGet<LeaveBalance>("/me/leave-balance"),
  });

  const myLeaves = leavesQuery.data ?? [];
  const balance = balanceQuery.data;
  const quotaExhausted = !!balance && balance.remaining <= 0;

  const [leaveOpen, setLeaveOpen] = useState(false);
  const [leaveForm, setLeaveForm] = useState<{
    leave_type: LeaveType;
    start_date: string;
    end_date: string;
    reason: string;
  }>({ leave_type: "annual", start_date: todayStr(), end_date: todayStr(), reason: "" });

  const leaveMutation = useMutation({
    mutationFn: () => apiPost<LeaveRequest>("/me/leaves", leaveForm),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["me"] });
      setLeaveOpen(false);
      toast.success("تم إرسال طلب الإجازة — بانتظار موافقة المدير");
    },
    onError: (error) => toast.error(errorText(error)),
  });

  const submitLeave = () => {
    if (leaveForm.end_date < leaveForm.start_date) {
      toast.error("تاريخ النهاية يجب أن يكون بعد تاريخ البداية");
      return;
    }
    leaveMutation.mutate();
  };

  return (
    <FadeIn>
      <PageHeader
        title="إجازاتي"
        description="رصيدك الحالي وطلباتك السابقة."
        testid="my-leaves-title"
      />

      <div className="space-y-5">
        {balanceQuery.isLoading ? (
          <LoadingBlock className="h-28" />
        ) : balance ? (
          <div
            className="rounded-2xl border border-teal-100 bg-teal-50/70 p-5 shadow-xs"
            data-testid="leave-balance-box"
          >
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm font-semibold text-teal-900">المتبقي هذه الدورة</span>
              <span className="text-2xl font-extrabold tabular-nums text-teal-800" data-testid="leave-remaining">
                {formatNumber(balance.remaining)} / {formatNumber(balance.quota)}
              </span>
            </div>
            <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-teal-200/60">
              <div
                className="h-full rounded-full bg-teal-600 transition-all duration-300"
                style={{
                  width: `${balance.quota > 0 ? Math.min(100, (balance.used / balance.quota) * 100) : 100}%`,
                }}
              />
            </div>
            <p className="mt-2 text-xs tabular-nums text-teal-800/80">
              الدورة: {fmtDate(balance.cycle_start)} ← {fmtDate(balance.cycle_end)} • المستخدم{" "}
              {formatNumber(balance.used)}
            </p>
          </div>
        ) : null}

        <Button
          className="w-full"
          size="lg"
          onClick={() => setLeaveOpen(true)}
          disabled={quotaExhausted}
          data-testid="my-leave-request-btn"
        >
          <CalendarPlus className="h-4 w-4" />
          {quotaExhausted ? "نفد رصيد الدورة" : "طلب إجازة"}
        </Button>
        {quotaExhausted && (
          <p
            className="rounded-xl bg-amber-50 px-4 py-3 text-xs text-amber-800"
            data-testid="quota-exhausted-note"
          >
            استنفدت عدد الإجازات المسموح ({formatNumber(balance!.quota)}) خلال دورتك الحالية. يمكنك
            التقديم بعد {fmtDate(balance!.cycle_end)}.
          </p>
        )}

        <CardSection title="طلباتي" testid="my-leaves-card">
          {leavesQuery.isLoading ? (
            <LoadingBlock className="h-40" />
          ) : myLeaves.length === 0 ? (
            <EmptyState title="لا توجد طلبات" description="قدّم طلبك الأول." />
          ) : (
            <div className="space-y-2">
              {myLeaves.map((leave) => (
                <div
                  key={leave.id}
                  data-testid={`my-leave-row-${leave.id}`}
                  className="rounded-xl border border-slate-100 bg-slate-50/60 px-4 py-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-slate-800">
                      {LEAVE_TYPE_LABELS[leave.leave_type]}
                    </span>
                    <StatusBadge
                      tone={leave.status === "pending" ? "amber" : leave.status === "approved" ? "green" : "red"}
                      label={LEAVE_STATUS_LABELS[leave.status]}
                      testid={`my-leave-status-${leave.id}`}
                    />
                  </div>
                  <p className="mt-1 text-xs tabular-nums text-slate-500">
                    {fmtDate(leave.start_date)} ← {fmtDate(leave.end_date)}
                  </p>
                  {leave.reason && <p className="mt-1 text-xs text-slate-500">السبب: {leave.reason}</p>}
                  {leave.manager_note && (
                    <p className="mt-1 text-xs text-slate-500">ملاحظة المدير: {leave.manager_note}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardSection>
      </div>

      <Dialog open={leaveOpen} onOpenChange={setLeaveOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>طلب إجازة جديد</DialogTitle>
            <DialogDescription>
              {balance
                ? `المتبقي ${formatNumber(balance.remaining)} من ${formatNumber(balance.quota)} خلال دورتك الحالية (${fmtDate(balance.cycle_start)} ← ${fmtDate(balance.cycle_end)}).`
                : "سيصل طلبك إلى المدير للمراجعة."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>نوع الإجازة</Label>
              <Select
                value={leaveForm.leave_type}
                onValueChange={(v: string) => setLeaveForm({ ...leaveForm, leave_type: v as LeaveType })}
              >
                <SelectTrigger data-testid="leave-type-select">
                  <SelectValue>{(v: string) => LEAVE_TYPE_LABELS[v as LeaveType]}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="annual">سنوية</SelectItem>
                  <SelectItem value="sick">مرضية</SelectItem>
                  <SelectItem value="unpaid">بدون راتب</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="leave-start">من تاريخ</Label>
                <Input
                  id="leave-start"
                  type="date"
                  value={leaveForm.start_date}
                  onChange={(e) => setLeaveForm({ ...leaveForm, start_date: e.target.value })}
                  data-testid="leave-start-input"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="leave-end">إلى تاريخ</Label>
                <Input
                  id="leave-end"
                  type="date"
                  value={leaveForm.end_date}
                  onChange={(e) => setLeaveForm({ ...leaveForm, end_date: e.target.value })}
                  data-testid="leave-end-input"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="leave-reason">السبب</Label>
              <Textarea
                id="leave-reason"
                rows={3}
                value={leaveForm.reason}
                onChange={(e) => setLeaveForm({ ...leaveForm, reason: e.target.value })}
                placeholder="اكتب سبب الإجازة (اختياري)"
                data-testid="leave-reason-input"
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setLeaveOpen(false)} data-testid="leave-cancel-btn">
              إلغاء
            </Button>
            <Button onClick={submitLeave} disabled={leaveMutation.isPending} data-testid="leave-submit-btn">
              إرسال الطلب
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </FadeIn>
  );
}