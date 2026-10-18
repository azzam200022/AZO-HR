import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { KeyRound, LogIn, Mail, ShieldCheck, Users } from "lucide-react";
import { apiPost } from "@/lib/api";
import { errorText } from "@/lib/format";
import type { SessionInfo } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function Login() {
  const queryClient = useQueryClient();
  const [managerForm, setManagerForm] = useState({ email: "", password: "" });
  const [code, setCode] = useState("");
  const [employeeForm, setEmployeeForm] = useState({ email: "", password: "" });

  const onLoggedIn = (session: SessionInfo) => {
    queryClient.setQueryData(["session"], session);
    queryClient.invalidateQueries();
    toast.success(session.role === "manager" ? "أهلاً بك يا مدير النظام" : `أهلاً بك ${session.name}`);
  };

  const managerLogin = useMutation({
    mutationFn: () => apiPost<SessionInfo>("/auth/manager-login", managerForm),
    onSuccess: onLoggedIn,
    onError: (error) => toast.error(errorText(error)),
  });

  const codeLogin = useMutation({
    mutationFn: () => apiPost<SessionInfo>("/auth/employee-login", { access_code: code }),
    onSuccess: onLoggedIn,
    onError: (error) => toast.error(errorText(error)),
  });

  const employeePasswordLogin = useMutation({
    mutationFn: () => apiPost<SessionInfo>("/auth/employee-login", employeeForm),
    onSuccess: onLoggedIn,
    onError: (error) => toast.error(errorText(error)),
  });

  return (
    <div className="grid min-h-svh lg:grid-cols-[1.1fr_1fr]">
      {/* Brand panel */}
      <div className="relative hidden overflow-hidden bg-gradient-to-bl from-teal-900 via-slate-900 to-slate-950 p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="absolute -start-16 top-24 h-72 w-72 rounded-full bg-teal-500/20 blur-2xl" />
        <div className="absolute -end-10 bottom-10 h-64 w-64 rounded-full bg-teal-400/10 blur-2xl" />
        <div className="relative z-10 flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/10">
            <Users className="h-6 w-6" />
          </span>
          <div>
            <p className="text-lg font-extrabold">مواردي</p>
            <p className="text-xs text-teal-200">إدارة الموارد البشرية</p>
          </div>
        </div>
        <div className="relative z-10 max-w-md">
          <h1 className="text-4xl font-extrabold leading-tight">
            منصّة واحدة
            <br />
            لإدارة فريقك بالكامل
          </h1>
          <p className="mt-4 text-sm leading-relaxed text-slate-300">
            الحضور الجغرافي، الإجازات، ومسير الرواتب — لوحة المدير محمية، ولكل موظف بوابته
            الخاصة برمز دخول يصدره المدير.
          </p>
        </div>
        <p className="relative z-10 text-xs text-slate-400">
          محمي بجلسات مشفّرة — الصلاحيات تُفحص على الخادم
        </p>
      </div>

      {/* Form panel */}
      <div className="flex items-center justify-center bg-slate-50 px-5 py-12">
        <div className="w-full max-w-md">
          <div className="mb-7 lg:hidden">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-teal-500 to-teal-700 text-white">
              <Users className="h-6 w-6" />
            </span>
            <p className="mt-3 text-xl font-extrabold text-slate-900">مواردي</p>
          </div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-900" data-testid="login-title">
            تسجيل الدخول
          </h2>
          <p className="mt-1 text-sm text-slate-500">اختر نوع الحساب للمتابعة.</p>

          <Tabs defaultValue="employee" className="mt-6">
            <TabsList className="w-full" data-testid="login-tabs">
              <TabsTrigger value="employee" className="flex-1" data-testid="login-tab-employee">
                موظف
              </TabsTrigger>
              <TabsTrigger value="manager" className="flex-1" data-testid="login-tab-manager">
                مدير النظام
              </TabsTrigger>
            </TabsList>

            {/* Employee: access code (primary) + optional email/password */}
            <TabsContent value="employee" className="mt-5 space-y-5">
              <form
                className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-xs"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!code.trim()) {
                    toast.error("أدخل رمز الدخول");
                    return;
                  }
                  codeLogin.mutate();
                }}
              >
                <div className="space-y-2">
                  <Label htmlFor="access-code" className="flex items-center gap-1.5">
                    <KeyRound className="h-3.5 w-3.5 text-teal-600" />
                    رمز الدخول
                  </Label>
                  <Input
                    id="access-code"
                    value={code}
                    onChange={(e) => setCode(e.target.value.toUpperCase())}
                    placeholder="MW-0000"
                    className="text-center text-lg font-bold tracking-widest tabular-nums"
                    dir="ltr"
                    data-testid="access-code-input"
                  />
                  <p className="text-xs text-slate-500">الرمز الذي زوّدك به مدير النظام.</p>
                </div>
                <Button
                  type="submit"
                  className="w-full"
                  disabled={codeLogin.isPending}
                  data-testid="employee-login-btn"
                >
                  <LogIn className="h-4 w-4" />
                  دخول بالرمز
                </Button>
              </form>

              <details className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
                <summary
                  className="cursor-pointer text-sm font-semibold text-slate-700"
                  data-testid="employee-password-toggle"
                >
                  أو الدخول بالبريد وكلمة المرور
                </summary>
                <form
                  className="mt-4 space-y-4"
                  onSubmit={(e) => {
                    e.preventDefault();
                    employeePasswordLogin.mutate();
                  }}
                >
                  <div className="space-y-2">
                    <Label htmlFor="emp-login-email">البريد الإلكتروني</Label>
                    <Input
                      id="emp-login-email"
                      type="email"
                      value={employeeForm.email}
                      onChange={(e) => setEmployeeForm({ ...employeeForm, email: e.target.value })}
                      dir="ltr"
                      data-testid="employee-email-login-input"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="emp-login-pass">كلمة المرور</Label>
                    <Input
                      id="emp-login-pass"
                      type="password"
                      value={employeeForm.password}
                      onChange={(e) => setEmployeeForm({ ...employeeForm, password: e.target.value })}
                      dir="ltr"
                      data-testid="employee-password-login-input"
                    />
                  </div>
                  <Button
                    type="submit"
                    variant="outline"
                    className="w-full"
                    disabled={employeePasswordLogin.isPending}
                    data-testid="employee-password-login-btn"
                  >
                    دخول
                  </Button>
                </form>
              </details>
            </TabsContent>

            {/* Manager */}
            <TabsContent value="manager" className="mt-5">
              <form
                className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-xs"
                onSubmit={(e) => {
                  e.preventDefault();
                  managerLogin.mutate();
                }}
              >
                <div className="space-y-2">
                  <Label htmlFor="mgr-email" className="flex items-center gap-1.5">
                    <Mail className="h-3.5 w-3.5 text-teal-600" />
                    البريد الإلكتروني
                  </Label>
                  <Input
                    id="mgr-email"
                    type="email"
                    value={managerForm.email}
                    onChange={(e) => setManagerForm({ ...managerForm, email: e.target.value })}
                    placeholder="manager@example.com"
                    dir="ltr"
                    data-testid="manager-email-input"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="mgr-pass" className="flex items-center gap-1.5">
                    <ShieldCheck className="h-3.5 w-3.5 text-teal-600" />
                    كلمة المرور
                  </Label>
                  <Input
                    id="mgr-pass"
                    type="password"
                    value={managerForm.password}
                    onChange={(e) => setManagerForm({ ...managerForm, password: e.target.value })}
                    dir="ltr"
                    data-testid="manager-password-input"
                  />
                </div>
                <Button
                  type="submit"
                  className="w-full"
                  disabled={managerLogin.isPending}
                  data-testid="manager-login-btn"
                >
                  <LogIn className="h-4 w-4" />
                  دخول لوحة المدير
                </Button>
                <p className="text-xs text-slate-500">
                  لوحة المدير مخصّصة لحساب مدير النظام المعتمد فقط.
                </p>
              </form>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}