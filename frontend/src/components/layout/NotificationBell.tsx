import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlarmClock, Bell, BellRing, CalendarDays, CheckCheck, CircleDollarSign, Gift, MapPinOff, MessageSquare } from "lucide-react";
import { apiGet, apiPost } from "@/lib/api";
import { browserPushSetupMessage } from "@/lib/browser-push-status";
import { fmtDate, formatNumber } from "@/lib/format";
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
import type { AppNotification, MarkAllResult, NotificationSummary } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
            attendance: "الحضور والانصراف",
            message: "رسالة جديدة",
            bonus: "حافز جديد",
            deduction: "خصم جديد",
            payroll: "تسوية الراتب",
            leave_request: "طلب إجازة جديد",
            leave_status: "تحديث الإجازة",
            shift_reminder: "تذكير بموعد الدوام",
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

  const notifications = listQuery.data ?? [];

  const iconFor = (kind: AppNotification["kind"]) =>
    kind === "late" || kind === "attendance" || kind === "shift_reminder"
      ? AlarmClock
      : kind === "left_site"
        ? MapPinOff
        : kind === "leave_request" || kind === "leave_status"
          ? CalendarDays
          : kind === "bonus"
            ? Gift
            : kind === "deduction" || kind === "payroll"
              ? CircleDollarSign
              : MessageSquare;

  const toneFor = (kind: AppNotification["kind"]) =>
    kind === "late" || kind === "leave_request" || kind === "shift_reminder"
      ? "bg-amber-100 text-amber-700"
      : kind === "left_site" || kind === "deduction"
        ? "bg-rose-100 text-rose-700"
        : kind === "bonus" || kind === "payroll"
          ? "bg-emerald-100 text-emerald-700"
          : "bg-teal-100 text-teal-700";

  const needsPushAction =
    permission !== "granted" || (!isNativePushPlatform() && !browserPushEnabled);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"
        title="الإشعارات"
        data-testid="notifications-bell"
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
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[21rem] p-0" data-testid="notifications-panel">
        <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2.5">
          <p className="text-sm font-bold text-slate-900">الإشعارات</p>
          {unread > 0 && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => readAll.mutate()}
              disabled={readAll.isPending}
              data-testid="notifications-read-all-btn"
            >
              <CheckCheck className="h-3.5 w-3.5" />
              تعليم الكل كمقروء
            </Button>
          )}
        </div>

        {needsPushAction && (
          <div className="border-b border-slate-100 bg-teal-50/70 px-3 py-2.5">
            {permission === "unsupported" ? (
              <p className="text-[11px] text-slate-600">
                {isNativePushPlatform()
                  ? "تعذر تفعيل إشعارات الجهاز."
                  : "متصفحك لا يدعم الإشعارات المنبثقة."}
              </p>
            ) : permission === "denied" ? (
              <p className="text-[11px] text-slate-600" data-testid="push-denied-note">
                {isNativePushPlatform()
                  ? "الإشعارات محظورة — فعّلها من إعدادات التطبيق في الجهاز."
                  : "الإشعارات محظورة من إعدادات المتصفح — فعّلها من إعدادات الموقع."}
              </p>
            ) : !isNativePushPlatform() && !browserPushChecked ? (
              <p className="text-[11px] text-slate-600">
                جارٍ التحقق من إعداد إشعارات المتصفح...
              </p>
            ) : permission === "setup-required" ||
              (!isNativePushPlatform() && !browserPushReady) ||
              (!isNativePushPlatform() && browserPushIssue !== null) ? (
              <div className="space-y-1.5">
                <p className="text-[11px] text-slate-600">
                  {browserPushSetupMessage(browserPushIssue)}
                </p>
                <button
                  type="button"
                  onClick={retryBrowserPushSetup}
                  className="flex w-full items-center gap-2 text-start text-[11px] font-semibold text-teal-800"
                  data-testid="retry-browser-push-btn"
                >
                  <BellRing className="h-3.5 w-3.5" />
                  إعادة فحص إعداد الإشعارات
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={enablePush}
                className="flex w-full items-center gap-2 text-start text-[11px] font-semibold text-teal-800"
                data-testid="enable-push-btn"
              >
                <BellRing className="h-3.5 w-3.5" />
                {isNativePushPlatform()
                  ? "تمكين إشعارات التطبيق"
                  : permission === "granted"
                    ? "تفعيل إشعارات هذا المتصفح"
                    : "تمكين الإشعارات المنبثقة في هذا المتصفح"}
              </button>
            )}
          </div>
        )}

        <div className="max-h-80 overflow-y-auto">
          {notifications.length === 0 ? (
            <p className="px-3 py-8 text-center text-xs text-slate-500" data-testid="notifications-empty">
              لا توجد إشعارات حالياً.
            </p>
          ) : (
            notifications.map((note) => {
              const Icon = iconFor(note.kind);
              return (
                <button
                  key={note.id}
                  type="button"
                  onClick={() => !note.read && readOne.mutate(note.id)}
                  className={cn(
                    "flex w-full gap-2.5 border-b border-slate-50 px-3 py-2.5 text-start transition-colors hover:bg-slate-50",
                    !note.read && "bg-amber-50/60",
                  )}
                  data-testid={`notification-item-${note.id}`}
                >
                  <span
                    className={cn(
                      "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg",
                      toneFor(note.kind),
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs leading-relaxed text-slate-700">{note.message}</span>
                    <span className="mt-1 block text-[10px] text-slate-400">
                      {fmtDate(note.date)} • {note.at_time}
                      {!note.read && " • غير مقروء"}
                    </span>
                  </span>
                </button>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
