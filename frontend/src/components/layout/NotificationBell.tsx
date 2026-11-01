import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlarmClock, Bell, CheckCheck, MapPinOff } from "lucide-react";
import { apiGet, apiPost } from "@/lib/api";
import { fmtDate, formatNumber } from "@/lib/format";
import type { AppNotification, NotificationSummary } from "@/lib/types";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/** Manager-only alert feed: fires when an employee is late or steps off site mid-shift. */
export default function NotificationBell() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const summaryQuery = useQuery({
    queryKey: ["notifications", "summary"],
    queryFn: () => apiGet<NotificationSummary>("/notifications/summary"),
    refetchInterval: 30_000,
  });

  const listQuery = useQuery({
    queryKey: ["notifications", "list"],
    queryFn: () => apiGet<AppNotification[]>("/notifications?limit=30"),
    enabled: open,
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["notifications"] });
  };

  const readOne = useMutation({
    mutationFn: (id: string) => apiPost<AppNotification>(`/notifications/${id}/read`, {}),
    onSuccess: refresh,
  });

  const readAll = useMutation({
    mutationFn: () => apiPost<{ updated: number }>("/notifications/read-all", {}),
    onSuccess: refresh,
  });

  const unread = summaryQuery.data?.unread ?? 0;
  const notifications = listQuery.data ?? [];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className="relative flex h-9 w-9 items-center justify-center rounded-full text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"
        title="تنبيهات التأخير"
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
      <PopoverContent align="end" className="w-[22rem] p-0" data-testid="notifications-panel">
        <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2.5">
          <p className="text-sm font-bold text-slate-900">تنبيهات الانضباط</p>
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
        <div className="max-h-80 overflow-y-auto">
          {notifications.length === 0 ? (
            <p className="px-3 py-8 text-center text-xs text-slate-500" data-testid="notifications-empty">
              لا توجد تنبيهات — جميع الموظفين ملتزمون بمواعيد دوامهم.
            </p>
          ) : (
            notifications.map((note) => (
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
                    note.kind === "late" ? "bg-amber-100 text-amber-700" : "bg-rose-100 text-rose-700",
                  )}
                >
                  {note.kind === "late" ? (
                    <AlarmClock className="h-3.5 w-3.5" />
                  ) : (
                    <MapPinOff className="h-3.5 w-3.5" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-xs leading-relaxed text-slate-700">{note.message}</span>
                  <span className="mt-1 block text-[10px] text-slate-400">
                    {fmtDate(note.date)} • {note.at_time}
                    {!note.read && " • غير مقروء"}
                  </span>
                </span>
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
