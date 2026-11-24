import { useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { CheckCircle2 } from "lucide-react";
import { apiPost } from "@/lib/api";
import { errorText } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import PublicLayout, { Section } from "@/pages/public/PublicLayout";

export default function DeleteAccount() {
  const [form, setForm] = useState({ name: "", contact: "", reason: "" });
  const submit = useMutation({ mutationFn: () => apiPost("/public/account-deletion", form) });
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    submit.mutate();
  };

  return (
    <PublicLayout title="طلب حذف الحساب">
      <Section heading="من داخل التطبيق">
        <p>افتح AZO HR ← الملف الشخصي ← «حذف الحساب»، ثم أكّد الطلب.</p>
      </Section>
      <Section heading="ما الذي يُحذف">
        <p>بيانات الحساب (الاسم، البريد، الهاتف، الصورة، رمز الدخول)، سجلات الموقع، الجلسات، ورموز الإشعارات — خلال 30 يومًا من الطلب. قد تحتفظ جهة العمل بسجلات الرواتب والحضور المطلوبة نظاميًا.</p>
      </Section>
      <Section heading="أو أرسل الطلب من هنا">
        {submit.isSuccess ? (
          <p className="flex items-center gap-2 rounded-2xl bg-emerald-50 p-4 font-semibold text-emerald-800" data-testid="public-delete-success">
            <CheckCircle2 className="h-5 w-5" /> تم استلام طلبك، وسيتواصل معك مدير النظام لتأكيد الحذف.
          </p>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4" data-testid="public-delete-form">
            <div className="space-y-1.5">
              <Label htmlFor="del-name">الاسم الكامل</Label>
              <Input id="del-name" required minLength={2} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="public-delete-name-input" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="del-contact">البريد أو رقم الهاتف المسجّل</Label>
              <Input id="del-contact" required minLength={3} dir="ltr" value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} data-testid="public-delete-contact-input" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="del-reason">السبب (اختياري)</Label>
              <Textarea id="del-reason" maxLength={500} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} data-testid="public-delete-reason-input" />
            </div>
            {submit.isError && <p className="text-rose-700" data-testid="public-delete-error">{errorText(submit.error)}</p>}
            <Button type="submit" disabled={submit.isPending} data-testid="public-delete-submit-btn">
              إرسال طلب الحذف
            </Button>
          </form>
        )}
      </Section>
    </PublicLayout>
  );
}
