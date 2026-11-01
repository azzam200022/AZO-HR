import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Megaphone, MessageSquare, Send, Users } from "lucide-react";
import { apiGet, apiPost } from "@/lib/api";
import { errorText, fmtDate } from "@/lib/format";
import type { BroadcastResult, MarkAllResult, Message, MessageThread } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState, FadeIn, LoadingBlock, PageHeader } from "@/components/shared";
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
            variant={broadcastMode ? "default" : "outline"}
            onClick={() => setBroadcastMode((v) => !v)}
            data-testid="broadcast-toggle-btn"
          >
            <Megaphone className="h-4 w-4" />
            {broadcastMode ? "وضع الإرسال للجميع مفعّل" : "إرسال للجميع"}
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[18rem_1fr]">
        {/* Thread list */}
        <aside className="rounded-2xl border border-slate-200 bg-white p-2 shadow-xs">
          {threadsQuery.isLoading ? (
            <LoadingBlock className="h-64" />
          ) : (
            <ul className="space-y-1" data-testid="message-threads-list">
              {threads.map((t) => {
                const isActive = t.thread === active.thread && t.employee_id === active.employeeId;
                return (
                  <li key={`${t.thread}-${t.employee_id}`}>
                    <button
                      type="button"
                      onClick={() => setActive({ thread: t.thread, employeeId: t.employee_id })}
                      className={cn(
                        "flex w-full items-start gap-2.5 rounded-xl px-3 py-2.5 text-start transition-colors",
                        isActive ? "bg-teal-50 ring-1 ring-teal-200" : "hover:bg-slate-50",
                      )}
                      data-testid={`message-thread-${t.thread === "group" ? "group" : t.employee_id}`}
                    >
                      <span
                        className={cn(
                          "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold",
                          t.thread === "group"
                            ? "bg-indigo-100 text-indigo-700"
                            : "bg-slate-100 text-slate-600",
                        )}
                      >
                        {t.thread === "group" ? <Users className="h-4 w-4" /> : t.name.charAt(0)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center justify-between gap-2">
                          <span className="truncate text-sm font-semibold text-slate-900">
                            {t.name}
                          </span>
                          {t.unread > 0 && (
                            <span
                              className="flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-bold text-white"
                              data-testid={`thread-unread-${t.thread === "group" ? "group" : t.employee_id}`}
                            >
                              {t.unread}
                            </span>
                          )}
                        </span>
                        <span className="mt-0.5 block truncate text-[11px] text-slate-500">
                          {t.last_body || t.job_title}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>

        {/* Conversation */}
        <section className="flex min-h-[28rem] flex-col rounded-2xl border border-slate-200 bg-white shadow-xs">
          <header className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
            <MessageSquare className="h-4 w-4 text-teal-600" />
            <p className="text-sm font-bold text-slate-900" data-testid="active-thread-name">
              {activeThread?.name ?? "مجموعة الفريق"}
            </p>
          </header>

          <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4" data-testid="message-list">
            {messagesQuery.isLoading ? (
              <LoadingBlock className="h-40" />
            ) : messages.length === 0 ? (
              <EmptyState
                title="لا توجد رسائل بعد"
                description="اكتب أول رسالة في الأسفل لبدء المحادثة."
              />
            ) : (
              messages.map((m) => (
                <div
                  key={m.id}
                  className={cn("flex", m.sender === "manager" ? "justify-start" : "justify-end")}
                  data-testid={`message-${m.id}`}
                >
                  <div
                    className={cn(
                      "max-w-[75%] rounded-2xl px-3.5 py-2.5 text-sm shadow-xs",
                      m.sender === "manager"
                        ? "rounded-ss-sm bg-teal-600 text-white"
                        : "rounded-se-sm bg-slate-100 text-slate-800",
                    )}
                  >
                    <p className="whitespace-pre-wrap leading-relaxed">{m.body}</p>
                    <p
                      className={cn(
                        "mt-1 text-[10px]",
                        m.sender === "manager" ? "text-teal-100" : "text-slate-500",
                      )}
                    >
                      {m.sender === "manager" ? "الإدارة" : m.sender_name} • {fmtDate(m.created_at.slice(0, 10))} {timeOf(m.created_at)}
                    </p>
                  </div>
                </div>
              ))
            )}
            <div ref={endRef} />
          </div>

          <footer className="border-t border-slate-100 p-3">
            {broadcastMode && (
              <p className="mb-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                ستصل هذه الرسالة إلى محادثة كل موظف نشِط على حدة.
              </p>
            )}
            <div className="flex items-end gap-2">
              <Textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={broadcastMode ? "رسالة لكل الموظفين..." : "اكتب رسالتك..."}
                rows={2}
                className="flex-1 resize-none"
                data-testid="message-input"
              />
              <Button
                onClick={submit}
                disabled={sending || !draft.trim()}
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
