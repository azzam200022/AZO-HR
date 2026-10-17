import { useState, type ReactNode } from "react";
import { motion } from "motion/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { apiPatch } from "@/lib/api";
import { errorText } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { LeaveWithEmployee } from "@/lib/types";

export function FadeIn({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: "easeOut" }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

export function PageHeader({
  title,
  description,
  action,
  testid,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  testid?: string;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 md:text-3xl" data-testid={testid}>
          {title}
        </h1>
        {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function KpiCard({
  label,
  value,
  hint,
  icon,
  testid,
}: {
  label: string;
  value: string;
  hint?: string;
  icon: ReactNode;
  testid: string;
}) {
  return (
    <div
      data-testid={testid}
      className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{label}</p>
          <p className="mt-2 truncate text-2xl font-bold tabular-nums tracking-tight text-slate-900">
            {value}
          </p>
          {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
        </div>
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-teal-50 text-teal-600">
          {icon}
        </span>
      </div>
    </div>
  );
}

type Tone = "green" | "amber" | "red" | "slate" | "indigo" | "teal";

const TONES: Record<Tone, string> = {
  green: "bg-emerald-100 text-emerald-800",
  amber: "bg-amber-100 text-amber-800",
  red: "bg-red-100 text-red-800",
  slate: "bg-slate-100 text-slate-700",
  indigo: "bg-indigo-100 text-indigo-800",
  teal: "bg-teal-100 text-teal-800",
};

export function StatusBadge({
  tone,
  label,
  testid,
}: {
  tone: Tone;
  label: string;
  testid?: string;
}) {
  return (
    <span
      data-testid={testid}
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap",
        TONES[tone],
      )}
    >
      {label}
    </span>
  );
}

export function EmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50/60 px-6 py-10 text-center">
      <p className="text-sm font-semibold text-slate-700">{title}</p>
      {description && <p className="mt-1 text-xs text-slate-500">{description}</p>}
    </div>
  );
}

export function LoadingBlock({ className }: { className?: string }) {
  return (
    <div className={cn("h-40 animate-pulse rounded-2xl border border-slate-200 bg-slate-100", className)} />
  );
}

export function CardSection({
  title,
  action,
  children,
  testid,
  className,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  testid?: string;
  className?: string;
}) {
  return (
    <section
      data-testid={testid}
      className={cn("rounded-2xl border border-slate-200 bg-white p-5 shadow-xs", className)}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-bold text-slate-900">{title}</h2>
        {action}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function ConfirmDeleteDialog({
  open,
  onOpenChange,
  title,
  description,
  onConfirm,
  testId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  onConfirm: () => void;
  testId: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="cancel-delete-btn">
            إلغاء
          </Button>
          <Button variant="destructive" onClick={onConfirm} data-testid={testId}>
            تأكيد الحذف
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function LeaveReviewButtons({ leave }: { leave: LeaveWithEmployee }) {
  const queryClient = useQueryClient();
  const [rejectOpen, setRejectOpen] = useState(false);
  const [note, setNote] = useState("");

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    queryClient.invalidateQueries({ queryKey: ["leaves"] });
  };

  const { mutate: approve, isPending: approving } = useMutation({
    mutationFn: () => apiPatch(`/leaves/${leave.id}`, { status: "approved" }),
    onSuccess: () => {
      invalidate();
      toast.success(`تمت الموافقة على طلب ${leave.employee_name}`);
    },
    onError: (error) => toast.error(errorText(error)),
  });

  const { mutate: reject, isPending: rejecting } = useMutation({
    mutationFn: () => apiPatch(`/leaves/${leave.id}`, { status: "rejected", manager_note: note }),
    onSuccess: () => {
      invalidate();
      setRejectOpen(false);
      setNote("");
      toast.success(`تم رفض طلب ${leave.employee_name}`);
    },
    onError: (error) => toast.error(errorText(error)),
  });

  return (
    <div className="flex items-center gap-2">
      <Button
        size="sm"
        onClick={() => approve()}
        disabled={approving}
        data-testid={`leave-approve-btn-${leave.id}`}
      >
        موافقة
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={() => setRejectOpen(true)}
        data-testid={`leave-reject-btn-${leave.id}`}
      >
        رفض
      </Button>
      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>رفض طلب {leave.employee_name}</DialogTitle>
            <DialogDescription>يمكنك إضافة ملاحظة للموظف حول سبب الرفض.</DialogDescription>
          </DialogHeader>
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="ملاحظة المدير (اختياري)"
            rows={3}
            data-testid="reject-note-textarea"
          />
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setRejectOpen(false)} data-testid="cancel-reject-btn">
              إلغاء
            </Button>
            <Button
              variant="destructive"
              onClick={() => reject()}
              disabled={rejecting}
              data-testid="confirm-reject-btn"
            >
              تأكيد الرفض
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}