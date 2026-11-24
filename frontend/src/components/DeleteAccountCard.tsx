import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiGet, apiPost } from "@/lib/api";
import { errorText } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";

type DeletionRequest = { id: string; status: string; created_at: string } | null;

export default function DeleteAccountCard() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const requestQuery = useQuery({
    queryKey: ["me", "account-deletion"],
    queryFn: () => apiGet<DeletionRequest>("/me/account-deletion"),
  });
  const submit = useMutation({
    mutationFn: () => apiPost<DeletionRequest>("/me/account-deletion", { reason }),
    onSuccess: (saved) => {
      queryClient.setQueryData(["me", "account-deletion"], saved);
      setOpen(false);
      toast.success("تم إرسال طلب حذف الحساب إلى المدير");
    },
    onError: (error) => toast.error(errorText(error)),
  });
  const pending = requestQuery.data?.status === "pending";

  return (
    <div className="mt-4 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-xs" data-testid="account-privacy-card">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-semibold text-slate-800">حذف الحساب</span>
        {pending ? (
          <span className="text-xs font-semibold text-amber-700" data-testid="account-deletion-pending">الطلب قيد المراجعة</span>
        ) : (
          <Button type="button" size="sm" variant="destructive" onClick={() => setOpen(true)} data-testid="account-deletion-open-btn">
            طلب الحذف
          </Button>
        )}
      </div>
      <Link to="/privacy" className="mt-3 block border-t border-slate-100 pt-3 text-sm font-semibold text-teal-700" data-testid="profile-privacy-link">
        سياسة الخصوصية
      </Link>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm" dir="rtl" data-testid="account-deletion-dialog">
          <DialogTitle>حذف حسابك</DialogTitle>
          <DialogDescription>
            سيُرسل طلبك إلى المدير، وعند تنفيذه تُحذف بيانات حسابك وموقعك وتُنهى جلساتك. قد تحتفظ جهة العمل بسجلات الرواتب المطلوبة نظاميًا.
          </DialogDescription>
          <Textarea placeholder="السبب (اختياري)" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="account-deletion-reason-input" />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} data-testid="account-deletion-cancel-btn">إلغاء</Button>
            <Button type="button" variant="destructive" disabled={submit.isPending} onClick={() => submit.mutate()} data-testid="account-deletion-confirm-btn">
              تأكيد الطلب
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
