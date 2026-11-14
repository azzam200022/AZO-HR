import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Megaphone, MessageSquare, Send, Users } from "lucide-react";
import { apiGet, apiPost } from "@/lib/api";
import { errorText, fmtDate, formatNumber } from "@/lib/format";
import type { BroadcastResult, MarkAllResult, Message, MessageThread } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState, FadeIn, LoadingBlock, PageHeader, StatusBadge } from "@/components/shared";
import { cn } from "@/lib/utils";

const timeOf = (iso: string) => {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

export default function Messages() {
  const queryClient = useQueryClient();
  const [active, setActive] = useState<{ thread: "direct" | "group"; employeeId: string }>({
    thread: "group",
    employeeId: "",
  });
  const [draft, setDraft] = useState("");
  const [broadcastMode, setBroadcastMode] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const threadsQuery = useQuery({
    queryKey: ["message-threads"],
    queryFn: () => apiGet<MessageThread[]>("/messages/threads"),
    refetchInterval: 20_000,
  });

  const messagesQuery = useQuery({
    queryKey: ["messages", active.thread, active.employeeId],
    queryFn: () =>
      apiGet<Message[]>(
        active.thread === "group" ? "/messages" : `/messages?employee_id=${active.employeeId}`,
      ),
    refetchInterval: 15_000,
  });

  const threads = threadsQuery.data ?? [];
  const messages = messagesQuery.data ?? [];
  const activeThread = threads.find(
    (t) => t.thread === active.thread && t.employee_id === active.employeeId,
  );

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  // Opening a thread clears its unread badge for the manager.
  const readMutation = useMutation({
    mutationFn: () =>
      apiPost<MarkAllResult>("/messages/read", {
        thread: active.thread,
        employee_id: active.employeeId,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["message-threads"] });
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });

  useEffect(() => {
    if ((activeThread?.unread ?? 0) > 0) readMutation.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeThread?.unread, active.thread, active.employeeId]);

  const sendMutation = useMutation({
    mutationFn: () =>
      apiPost<Message>("/messages", {
        thread: active.thread,
        employee_id: active.employeeId,
        body: draft,
      }),
    onSuccess: () => {
      setDraft("");
      queryClient.invalidateQueries({ queryKey: ["messages"] });
      queryClient.invalidateQueries({ queryKey: ["message-threads"] });
    },
    onError: (error) => toast.error(errorText(error)),
  });

  const broadcastMutation = useMutation({
    mutationFn: () => apiPost<BroadcastResult>("/messages/broadcast", { body: draft }),
    onSuccess: (result) => {
      setDraft("");
      setBroadcastMode(false);
      queryClient.invalidateQueries({ queryKey: ["messages"] });
      queryClient.invalidateQueries({ queryKey: ["message-threads"] });
      toast.success(`تم إرسال الرسالة إلى ${result.sent} موظفاً`);
    },
    onError: (error) => toast.error(errorText(error)),
  });

  const submit = () => {
    if (!draft.trim()) return;
    if (broadcastMode) broadcastMutation.mutate();
    else sendMutation.mutate();
  };

  const sending = sendMutation.isPending || broadcastMutation.isPending;

  return (
    <FadeIn>
      <PageHeader
        title="الرسائل"
        description="محادثة خاصة مع كل موظف، ومجموعة عامة لإعلانات الفريق."
        testid="messages-title"
        action={
          <Button
            type="button"
            variant={broadcastMode ? "default" : "outline"}
            aria-pressed={broadcastMode}
            onClick={() => setBroadcastMode((v) => !v)}
            className="rounded-xl"
            data-testid="broadcast-toggle-btn"
          >
            <Megaphone className="h-4 w-4" />
            {broadcastMode ? "وضع الإرسال للجميع مفعّل" : "إرسال للجميع"}
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[18rem_minmax(0,1fr)] xl:gap-5">
        <aside className="flex min-h-[18rem] max-h-[25rem] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs lg:max-h-[36rem] lg:min-h-[32rem]">
          <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/60 px-4 py-3.5">
            <div>
              <h2 className="text-sm font-bold text-slate-900">المحادثات</h2>
              <p className="mt-0.5 text-xs text-slate-500">اختر محادثة لعرض الرسائل</p>
            </div>
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-50 text-teal-700">
              <MessageSquare className="h-4 w-4" />
            </span>
          </div>
          {threadsQuery.isLoading ? (
            <div className="p-3">
              <LoadingBlock className="h-56" />
            </div>
          ) : threads.length === 0 ? (
            <div className="p-3">
              <EmptyState title="لا توجد محادثات" description="ستظهر المحادثات هنا عند بدء التواصل مع الموظفين." />
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              <ul className="space-y-1.5" data-testid="message-threads-list">
                {threads.map((t) => {
                  const isActive = t.thread === active.thread && t.employee_id === active.employeeId;
                  return (
                    <li key={`${t.thread}-${t.employee_id}`}>
                      <button
                        type="button"
                        onClick={() => setActive({ thread: t.thread, employeeId: t.employee_id })}
                        className={cn(
                          "flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-start transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500",
                          isActive
                            ? "border-teal-200 bg-teal-50 shadow-xs"
                            : "border-transparent hover:border-slate-200 hover:bg-slate-50",
                        )}
                        data-testid={`message-thread-${t.thread === "group" ? "group" : t.employee_id}`}
                      >
                        <span
                          className={cn(
                            "flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-sm font-bold",
                            t.thread === "group"
                              ? "bg-teal-100 text-teal-700"
                              : "bg-slate-100 text-slate-700",
                          )}
                        >
                          {t.thread === "group" ? <Users className="h-4 w-4" /> : t.name.charAt(0)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center justify-between gap-2">
                            <span className={cn("truncate text-sm font-semibold", isActive ? "text-teal-900" : "text-slate-900")}>
                              {t.name}
                            </span>
                            {t.unread > 0 && (
                              <span
                                className="flex h-5 min-w-5 items-center justify-center rounded-full bg-teal-600 px-1 text-[10px] font-bold text-white"
                                data-testid={`thread-unread-${t.thread === "group" ? "group" : t.employee_id}`}
                              >
                                {formatNumber(t.unread)}
                              </span>
                            )}
                          </span>
                          <span className="mt-1 block truncate text-[11px] text-slate-500">
                            {t.last_body || (t.thread === "group" ? "إعلانات الفريق" : t.job_title || "محادثة خاصة")}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </aside>

        <section className="flex min-h-[30rem] min-w-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs">
          <header className="flex items-center gap-3 border-b border-slate-100 bg-slate-50/60 px-4 py-3.5 sm:px-5">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-teal-100 text-teal-700">
              {active.thread === "group" ? <Users className="h-4.5 w-4.5" /> : activeThread?.name.charAt(0) ?? <MessageSquare className="h-4 w-4" />}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-slate-900" data-testid="active-thread-name">
                {activeThread?.name ?? "مجموعة الفريق"}
              </p>
              <p className="mt-0.5 truncate text-xs text-slate-500">
                {active.thread === "group" ? "إعلانات عامة لفريق العمل" : activeThread?.job_title || "محادثة خاصة"}
              </p>
            </div>
            <div className="ms-auto hidden sm:block">
              <StatusBadge
                tone={active.thread === "group" ? "teal" : "slate"}
                label={active.thread === "group" ? "مجموعة عامة" : "محادثة مباشرة"}
              />
            </div>
          </header>

          <div className="flex-1 space-y-4 overflow-y-auto bg-slate-50/60 px-3 py-4 sm:px-5" data-testid="message-list">
            {messagesQuery.isLoading ? (
              <LoadingBlock className="h-40" />
            ) : messages.length === 0 ? (
              <div className="flex min-h-[16rem] items-center justify-center">
                <EmptyState
                  title="لا توجد رسائل بعد"
                  description="اكتب أول رسالة في الأسفل لبدء المحادثة."
                />
              </div>
            ) : (
              messages.map((m) => (
                <div
                  key={m.id}
                  className={cn("flex", m.sender === "manager" ? "justify-start" : "justify-end")}
                  data-testid={`message-${m.id}`}
                >
                  <div className="max-w-[88%] sm:max-w-[75%]">
                    <div
                      className={cn(
                        "rounded-2xl px-4 py-3 text-sm shadow-xs",
                        m.sender === "manager"
                          ? "rounded-ss-sm bg-teal-600 text-white"
                          : "rounded-se-sm border border-slate-200 bg-white text-slate-800",
                      )}
                    >
                      <p className="whitespace-pre-wrap leading-relaxed">{m.body}</p>
                    </div>
                    <p
                      className={cn(
                        "mt-1.5 px-1 text-[10px] text-slate-500",
                        m.sender === "manager" && "text-teal-700",
                      )}
                    >
                      {m.sender === "manager" ? "الإدارة" : m.sender_name} · {fmtDate(m.created_at.slice(0, 10))} {timeOf(m.created_at)}
                    </p>
                  </div>
                </div>
              ))
            )}
            <div ref={endRef} />
          </div>

          <footer className="border-t border-slate-100 bg-white p-3 sm:p-4">
            {broadcastMode && (
              <div className="mb-3 flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3 text-xs text-amber-800">
                <Megaphone className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <p className="font-semibold">إرسال جماعي للفريق</p>
                  <p className="mt-0.5">ستصل الرسالة إلى محادثة كل موظف نشِط على حدة.</p>
                </div>
              </div>
            )}
            <div className="flex items-end gap-2 sm:gap-3">
              <Textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={broadcastMode ? "رسالة لكل الموظفين..." : "اكتب رسالتك..."}
                rows={2}
                className="min-h-[4.5rem] flex-1 resize-none rounded-xl bg-slate-50/60 text-sm"
                data-testid="message-input"
              />
              <Button
                type="button"
                onClick={submit}
                disabled={sending || !draft.trim()}
                className="h-10 shrink-0 rounded-xl px-4 sm:h-11"
                aria-label="إرسال الرسالة"
                data-testid="message-send-btn"
              >
                <Send className="h-4 w-4" />
                إرسال
              </Button>
            </div>
          </footer>
        </section>
      </div>
    </FadeIn>
  );
}
