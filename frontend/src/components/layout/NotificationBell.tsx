import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlarmClock, Bell, BellRing, CalendarDays, Check, CheckCheck, CircleDollarSign, Gift, MapPin, MapPinOff, MessageSquare, Package, Smartphone, X } from "lucide-react";
import { apiGet, apiPost } from "@/lib/api";
import { errorText, fmtDate, formatNumber } from "@/lib/format";
import { browserPushSetupMessage } from "@/lib/browser-push-status";
import {
  currentPushPermission,
  getBrowserPushSetupIssue,
  initializeBrowserPush,
  initializeNativePush,
  isNativePushPlatform,
  prepareBrowserPush,
  pushPermission,
  requestPush,
  showPush,
  type PushPermission,
} from "@/lib/push";
import type { AppNotification, DeviceChangeRequest, MarkAllResult, NotificationSummary } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Props = { audience: "manager" | "employee" };

/** Role-scoped feed for attendance, leave, payroll, adjustments, and messages. */
export default function NotificationBell({ audience }: Props) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [permission, setPermission] = useState<PushPermission>(() => pushPermission());
  const [browserPushChecked, setBrowserPushChecked] = useState(isNativePushPlatform());
  const [browserPushReady, setBrowserPushReady] = useState(false);
  const [browserPushIssue, setBrowserPushIssue] = useState(
    getBrowserPushSetupIssue(),
  );
  const [browserPushEnabled, setBrowserPushEnabled] = useState(false);
  const lastUnread = useRef<number | null>(null);

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  useEffect(() => {
    let active = true;
    void initializeNativePush();
    void currentPushPermission().then((current) => {
      if (active) setPermission(current);
    });
    if (!isNativePushPlatform()) {
      void prepareBrowserPush().then((ready) => {
        if (!active) return;
        setBrowserPushReady(ready);
        setBrowserPushChecked(true);
        setBrowserPushIssue(ready ? null : getBrowserPushSetupIssue());
        if (ready) {
          void initializeBrowserPush().then((enabled) => {
            if (!active) return;
            setBrowserPushEnabled(enabled);
            if (!enabled && getBrowserPushSetupIssue()) {
              setBrowserPushIssue(getBrowserPushSetupIssue());
            }
          });
        }
      });
    }
    return () => {
      active = false;
    };
  }, []);

  const base = audience === "manager" ? "/notifications" : "/me/notifications";
  const scope = audience === "manager" ? ["notifications"] : ["me", "notifications"];

  const summaryQuery = useQuery({
    queryKey: [...scope, "summary"],
    queryFn: () => apiGet<NotificationSummary>(`${base}/summary`),
    refetchInterval: 5_000,
  });

  const listQuery = useQuery({
    queryKey: [...scope, "list"],
    queryFn: () => apiGet<AppNotification[]>(`${base}?limit=30`),
    enabled: open,
    refetchInterval: open ? 5_000 : false,
  });

  const deviceRequestsQuery = useQuery({
    queryKey: ["notifications", "device-change-requests"],
    queryFn: () => apiGet<DeviceChangeRequest[]>("/notifications/device-change-requests"),
    enabled: audience === "manager" && open,
    refetchInterval: audience === "manager" && open ? 5_000 : false,
  });

  const unread = summaryQuery.data?.unread ?? 0;

  // A rise in the unread counter raises a local/browser notification when allowed.
  useEffect(() => {
    if (isNativePushPlatform()) {
      // Native Android/iOS notifications arrive through FCM; a second local alert would duplicate them.
      lastUnread.current = unread;
      return;
    }
    if (lastUnread.current !== null && unread > lastUnread.current) {
      const fallback = `لديك ${unread} تنبيهاً غير مقروء`;
      void apiGet<AppNotification[]>(`${base}?limit=30`)
        .then((items) => {
          const latest = items.find((note) => !note.read);
          const titleByKind: Record<AppNotification["kind"], string> = {
            late: "تأخر عن الدوام",
            left_site: "مغادرة موقع العمل",
            returned_site: "عودة إلى موقع العمل",
            attendance: "الحضور والانصراف",
            message: "رسالة جديدة",
            bonus: "حافز جديد",
            deduction: "خصم جديد",
            payroll: "تسوية الراتب",
            leave_request: "طلب إجازة جديد",
            leave_status: "تحديث الإجازة",
            shift_reminder: "تذكير بموعد الدوام",
            product_expiry: "تذكير بانتهاء صلاحية مادة",
            device_change: "طلب دخول من جهاز جديد",
          };
          const title = latest ? titleByKind[latest.kind] : "مواردي — تنبيه جديد";
          return showPush(
            title,
            latest?.message ?? fallback,
            latest?.id ? `mawaridi-${latest.id}` : "mawaridi",
          );
        })
        .catch(() => showPush("مواردي — تنبيه جديد", fallback));
    }
    lastUnread.current = unread;
  }, [unread, base]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: scope });

  const readOne = useMutation({
    mutationFn: (id: string) =>
      apiPost<AppNotification>(
        audience === "manager" ? `/notifications/${id}/read` : `/me/notifications/${id}/read`,
        {},
      ),
    onSuccess: refresh,
  });

  const readAll = useMutation({
    mutationFn: () => apiPost<MarkAllResult>(`${base}/read-all`, {}),
    onSuccess: refresh,
  });

  const decideDeviceRequest = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: "approve" | "reject" }) =>
      apiPost<{ id: string; status: "approved" | "rejected" }>(
        `/notifications/device-change-requests/${id}/${decision}`,
        {},
      ),
    onSuccess: (result) => {
      toast.success(result.status === "approved" ? "تم اعتماد الجهاز الجديد" : "تم رفض طلب الجهاز");
      void queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
    onError: (error) => toast.error(errorText(error)),
  });

  const enablePush = async () => {
    const result = await requestPush();
    setPermission(result);
    setBrowserPushEnabled(result === "granted");
    if (result === "setup-required") {
      setBrowserPushIssue(getBrowserPushSetupIssue());
    }
    if (result === "granted") {
      await showPush("تم السماح بالإشعارات", "سيستخدم التطبيق هذا الإذن لإرسال التنبيهات.");
    }
  };

  const retryBrowserPushSetup = async () => {
    setBrowserPushChecked(false);
    setBrowserPushReady(false);
    setBrowserPushEnabled(false);
    setBrowserPushIssue(null);
    const currentPermission = pushPermission();
    setPermission(currentPermission);
    const ready = await prepareBrowserPush(true);
    setBrowserPushReady(ready);
    setBrowserPushChecked(true);
    setBrowserPushIssue(ready ? null : getBrowserPushSetupIssue());
    if (ready && currentPermission === "granted") {
      const enabled = await initializeBrowserPush();
      setBrowserPushEnabled(enabled);
      if (!enabled && getBrowserPushSetupIssue()) {
        setBrowserPushIssue(getBrowserPushSetupIssue());
      }
    }
  };

  const allNotifications = listQuery.data ?? [];
  const notifications =
    audience === "manager"
      ? allNotifications.filter((note) => note.kind !== "device_change")
      : allNotifications;
  const deviceRequests =
    audience === "manager" ? (deviceRequestsQuery.data ?? []) : [];

  const iconFor = (kind: AppNotification["kind"]) => {
    switch (kind) {
      case "late":
      case "attendance":
      case "shift_reminder":
        return AlarmClock;
      case "left_site":
        return MapPinOff;
      case "returned_site":
        return MapPin;
      case "leave_request":
      case "leave_status":
        return CalendarDays;
      case "bonus":
        return Gift;
      case "product_expiry":
        return Package;
      case "device_change":
        return Smartphone;
      case "deduction":
      case "payroll":
        return CircleDollarSign;
      default:
        return MessageSquare;
    }
  };

  const toneFor = (kind: AppNotification["kind"]) =>
    kind === "late" || kind === "leave_request" || kind === "shift_reminder" || kind === "product_expiry" || kind === "device_change"
      ? "bg-amber-100 text-amber-700"
      : kind === "left_site" || kind === "deduction"
        ? "bg-rose-100 text-rose-700"
        : kind === "returned_site" || kind === "bonus" || kind === "payroll"
          ? "bg-emerald-100 text-emerald-700"
          : "bg-teal-100 text-teal-700";

  const needsPushAction =
    permission !== "granted" || (!isNativePushPlatform() && !browserPushEnabled);

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={() => setOpen(true)}
        aria-label="الإشعارات"
        title="الإشعارات"
        data-testid="notifications-bell"
        className="relative h-9 w-9 shrink-0 rounded-full text-slate-600 hover:bg-slate-100 hover:text-slate-900"
      >
        <Bell className="h-4.5 w-4.5" />
        {unread > 0 && (
          <span
            className="absolute top-0.5 end-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-bold text-white shadow-sm"
            data-testid="notifications-unread-count"
          >
            {unread > 9 ? "9+" : formatNumber(unread)}
          </span>
        )}
      </Button>
      {open &&
        createPortal(
          <section
            className="fixed inset-0 z-[100] flex h-[100dvh] w-full flex-col bg-background pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] text-foreground"
            role="dialog"
            aria-modal="true"
            aria-labelledby="notifications-title"
            dir="rtl"
            data-testid="notifications-panel"
          >
            <header className="flex shrink-0 items-center gap-3 border-b border-slate-200 bg-background px-3 py-2.5 sm:px-5">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setOpen(false)}
                aria-label="إغلاق الإشعارات والعودة"
                title="إغلاق"
                data-testid="notifications-close-btn"
                className="h-10 w-10 shrink-0 rounded-xl"
              >
                <X className="h-5 w-5" />
              </Button>
              <h1
                id="notifications-title"
                className="min-w-0 flex-1 text-lg font-bold text-slate-900"
              >
                الإشعارات
              </h1>
              {unread > 0 && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => readAll.mutate()}
                  disabled={readAll.isPending}
                  data-testid="notifications-read-all-btn"
                  className="shrink-0 px-2 text-xs sm:px-3 sm:text-sm"
                >
                  <CheckCheck className="h-4 w-4" />
                  تعليم الكل كمقروء
                </Button>
              )}
            </header>

            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {needsPushAction && (
          <div className="shrink-0 border-b border-slate-100 bg-teal-50/70 px-4 py-3 sm:px-6">
            {permission === "unsupported" ? (
              <p className="text-xs text-slate-600">
                {isNativePushPlatform()
                  ? "تعذر تفعيل إشعارات الجهاز."
                  : "متصفحك لا يدعم الإشعارات المنبثقة."}
              </p>
            ) : permission === "denied" ? (
              <p className="text-xs text-slate-600" data-testid="push-denied-note">
                {isNativePushPlatform()
                  ? "الإشعارات محظورة — فعّلها من إعدادات التطبيق في الجهاز."
                  : "الإشعارات محظورة من إعدادات المتصفح — فعّلها من إعدادات الموقع."}
              </p>
            ) : !isNativePushPlatform() && !browserPushChecked ? (
              <p className="text-xs text-slate-600">
                جارٍ التحقق من إعداد إشعارات المتصفح...
              </p>
            ) : permission === "setup-required" ||
              (!isNativePushPlatform() && !browserPushReady) ||
              (!isNativePushPlatform() && browserPushIssue !== null) ? (
              <div className="space-y-1.5">
                <p className="text-xs text-slate-600">
                  {browserPushSetupMessage(browserPushIssue)}
                </p>
                <button
                  type="button"
                  onClick={retryBrowserPushSetup}
                  className="flex w-full items-center gap-2 text-start text-xs font-semibold text-teal-800"
                  data-testid="retry-browser-push-btn"
                >
                  <BellRing className="h-4 w-4" />
                  إعادة فحص إعداد الإشعارات
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={enablePush}
                className="flex w-full items-center gap-2 text-start text-xs font-semibold text-teal-800"
                data-testid="enable-push-btn"
              >
                <BellRing className="h-4 w-4" />
                {isNativePushPlatform()
                  ? "تمكين إشعارات التطبيق"
                  : permission === "granted"
                    ? "تفعيل إشعارات هذا المتصفح"
                    : "تمكين الإشعارات المنبثقة في هذا المتصفح"}
              </button>
            )}
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {deviceRequests.length > 0 && (
            <section className="border-b border-slate-100 bg-amber-50/70 px-4 py-4 sm:px-6" data-testid="device-change-requests">
              <p className="mb-3 text-sm font-bold text-slate-800">طلبات دخول من جهاز جديد</p>
              <div className="space-y-2">
                {deviceRequests.map((request) => (
                  <div
                    key={request.id}
                    className="rounded-xl border border-amber-200 bg-white p-3"
                    data-testid={`device-change-request-${request.id}`}
                  >
                    <p className="text-sm font-semibold text-slate-800">{request.employee_name}</p>
                    <p className="mt-1 text-xs text-slate-500" dir="ltr">
                      جهاز جديد · …{request.device_hint}
                    </p>
                    <p className="mt-1 text-xs text-slate-400">
                      {fmtDate(request.created_at.slice(0, 10))} ·{" "}
                      {new Date(request.created_at).toLocaleTimeString("ar-IQ", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </p>
                    <div className="mt-2 flex gap-2">
                      <Button
                        size="sm"
                        className="h-8 flex-1"
                        onClick={() => decideDeviceRequest.mutate({ id: request.id, decision: "approve" })}
                        disabled={decideDeviceRequest.isPending}
                        data-testid={`approve-device-${request.id}`}
                      >
                        <Check className="h-3.5 w-3.5" />
                        موافقة
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 flex-1"
                        onClick={() => decideDeviceRequest.mutate({ id: request.id, decision: "reject" })}
                        disabled={decideDeviceRequest.isPending}
                        data-testid={`reject-device-${request.id}`}
                      >
                        <X className="h-3.5 w-3.5" />
                        رفض
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
          {notifications.length === 0 ? (
            deviceRequests.length === 0 ? (
              <div className="flex min-h-full items-center justify-center px-4 py-12">
                <p className="text-center text-sm text-slate-500" data-testid="notifications-empty">
                  لا توجد إشعارات حالياً.
                </p>
              </div>
            ) : null
          ) : (
            notifications.map((note) => {
              const Icon = iconFor(note.kind);
              return (
                <button
                  key={note.id}
                  type="button"
                  onClick={() => !note.read && readOne.mutate(note.id)}
                  className={cn(
                    "flex w-full gap-3 border-b border-slate-100 px-4 py-4 text-start transition-colors hover:bg-slate-50 sm:px-6",
                    !note.read && "bg-amber-50/60",
                  )}
                  data-testid={`notification-item-${note.id}`}
                >
                  <span
                    className={cn(
                      "mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
                      toneFor(note.kind),
                    )}
                  >
                    <Icon className="h-5 w-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm leading-relaxed text-slate-700">{note.message}</span>
                    <span className="mt-1.5 block text-xs text-slate-400">
                      {fmtDate(note.date)} • {note.at_time}
                      {!note.read && " • غير مقروء"}
                    </span>
                  </span>
                </button>
              );
            })
          )}
        </div>
            </div>
          </section>,
          document.body,
        )}
    </>
  );
}
