import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ArrowRight, Megaphone, MessageSquare, Users, X } from "lucide-react";
import MessageAvatar from "@/components/MessageAvatar";
import MessageAttachmentView from "@/components/MessageAttachmentView";
import MessageComposer, { type MessageComposerPayload } from "@/components/MessageComposer";
import { apiGet, apiPost, getApiOrigin } from "@/lib/api";
import { errorText, fmtDate, formatNumber } from "@/lib/format";
import type { BroadcastResult, MarkAllResult, Message, MessageThread } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { EmptyState, FadeIn, LoadingBlock, StatusBadge } from "@/components/shared";
import { cn } from "@/lib/utils";

const timeOf = (iso: string) => {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

export default function Messages() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const closeMessages = () => {
    const historyIndex = window.history.state?.idx;
    if (typeof historyIndex === "number" && historyIndex > 0) navigate(-1);
    else navigate("/", { replace: true });
  };
  const [active, setActive] = useState<{ thread: "direct" | "group"; employeeId: string }>({
    thread: "group",
    employeeId: "",
  });
  const [broadcastMode, setBroadcastMode] = useState(false);
  const messageListRef = useRef<HTMLDivElement>(null);
  const [mobileView, setMobileView] = useState<"threads" | "chat">("threads");

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
    const list = messageListRef.current;
    if (!list) return;
    list.scrollTo({ top: list.scrollHeight, behavior: "smooth" });
  }, [messages.length, active.thread, active.employeeId]);

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
    mutationFn: (payload: MessageComposerPayload) =>
      apiPost<Message>("/messages", {
        thread: active.thread,
        employee_id: active.employeeId,
        ...payload,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["messages"] });
      queryClient.invalidateQueries({ queryKey: ["message-threads"] });
    },
    onError: (error) => toast.error(errorText(error)),
  });

  const broadcastMutation = useMutation({
    mutationFn: (body: string) => apiPost<BroadcastResult>("/messages/broadcast", { body }),
    onSuccess: (result) => {
      setBroadcastMode(false);
      queryClient.invalidateQueries({ queryKey: ["messages"] });
      queryClient.invalidateQueries({ queryKey: ["message-threads"] });
      toast.success(`تم إرسال الرسالة إلى ${result.sent} موظفاً`);
    },
    onError: (error) => toast.error(errorText(error)),
  });

  const sendMessage = async (payload: MessageComposerPayload) => {
    if (broadcastMode) {
      if (payload.attachment) {
        toast.error("استخدم مجموعة الفريق لإرسال الصور أو الصوت");
        throw new Error("وسائط الإرسال الجماعي غير مدعومة");
      }
      await broadcastMutation.mutateAsync(payload.body);
      return;
    }
    await sendMutation.mutateAsync(payload);
  };

  const sending = sendMutation.isPending || broadcastMutation.isPending;

  return (
    <FadeIn className="flex h-full min-h-0 flex-col overflow-hidden bg-background pt-[env(safe-area-inset-top)]">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-slate-200 bg-white px-3 sm:gap-3 sm:px-5" data-testid="messages-app-header">
        <Button type="button" variant="ghost" size="icon" onClick={closeMessages} aria-label="العودة إلى التطبيق" title="العودة إلى التطبيق" data-testid="messages-close-btn" className="h-10 w-10 shrink-0 rounded-xl">
          <X className="h-5 w-5" />
        </Button>
        <h1 className="min-w-0 flex-1 truncate text-lg font-bold text-slate-900" data-testid="messages-title">الرسائل</h1>
        <Button
          type="button"
          variant={broadcastMode ? "default" : "outline"}
          aria-pressed={broadcastMode}
          onClick={() => setBroadcastMode((v) => !v)}
          className="shrink-0 rounded-xl px-3 text-xs sm:text-sm"
          data-testid="broadcast-toggle-btn"
        >
          <Megaphone className="h-4 w-4" />
          {broadcastMode ? "وضع الإرسال للجميع مفعّل" : "إرسال للجميع"}
        </Button>
      </header>

      <div className="grid min-h-0 min-w-0 flex-1 grid-cols-1 grid-rows-[minmax(0,1fr)] overflow-hidden md:grid-cols-[20rem_minmax(0,1fr)] md:grid-rows-1" data-testid="messages-workspace">
        <aside className={cn(
          "min-h-0 min-w-0 flex-col overflow-hidden border-slate-200 bg-white md:w-80 md:shrink-0 md:border-e",
          mobileView === "chat" ? "hidden md:flex" : "flex",
        )}>
          <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/60 px-4 py-3.5">
            <div>
              <h2 className="text-sm font-bold text-slate-900">الأشخاص</h2>
              <p className="mt-0.5 text-xs text-slate-500">اختر شخصًا أو مجموعة الفريق</p>
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
                        onClick={() => {
                          setActive({ thread: t.thread, employeeId: t.employee_id });
                          setMobileView("chat");
                        }}
                        className={cn(
                          "flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-start transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500",
                          isActive
                            ? "border-teal-200 bg-teal-50 shadow-xs"
                            : "border-transparent hover:border-slate-200 hover:bg-slate-50",
                        )}
                        data-testid={`message-thread-${t.thread === "group" ? "group" : t.employee_id}`}
                      >
                        {t.thread === "group" ? (
                          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-teal-100 text-teal-700">
                            <Users className="h-4 w-4" />
                          </span>
                        ) : (
                          <MessageAvatar
                            name={t.name}
                            photoUrl={
                              t.has_photo
                                ? `${getApiOrigin()}/api/employees/${t.employee_id}/photo`
                                : undefined
                            }
                            size="md"
                            testId={`message-thread-avatar-${t.employee_id}`}
                          />
                        )}
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

        <section className={cn(
          "min-h-0 min-w-0 flex-col overflow-hidden bg-white",
          mobileView === "threads" ? "hidden md:flex" : "flex",
        )}>
          <header className="flex items-center gap-3 border-b border-slate-100 bg-slate-50/60 px-4 py-3.5 sm:px-5">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => setMobileView("threads")}
              aria-label="العودة إلى المحادثات"
              data-testid="message-back-btn"
              className="h-9 w-9 shrink-0 rounded-xl md:hidden"
            >
              <ArrowRight className="h-4 w-4" />
            </Button>
            {active.thread === "group" ? (
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-teal-100 text-teal-700">
                <Users className="h-4 w-4" />
              </span>
            ) : (
              <MessageAvatar
                name={activeThread?.name ?? "الموظف"}
                photoUrl={
                  activeThread?.has_photo
                    ? `${getApiOrigin()}/api/employees/${activeThread.employee_id}/photo`
                    : undefined
                }
                size="md"
                testId="active-thread-avatar"
              />
            )}
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

          <div ref={messageListRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain bg-slate-50/60 px-3 py-4 sm:px-5" data-testid="message-list">
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
              messages.map((m) => {
                const senderThread =
                  m.sender === "employee"
                    ? threads.find((t) => t.thread === "direct" && t.employee_id === m.employee_id)
                    : undefined;
                const senderPhotoUrl = senderThread?.has_photo
                  ? `${getApiOrigin()}/api/employees/${m.employee_id}/photo`
                  : undefined;
                return (
                  <div
                    key={m.id}
                    className={cn(
                      "flex items-end gap-2",
                      m.sender === "manager" ? "justify-start" : "justify-end",
                    )}
                    data-testid={`message-${m.id}`}
                  >
                    {m.sender === "employee" && (
                      <MessageAvatar
                        name={senderThread?.name || m.sender_name}
                        photoUrl={senderPhotoUrl}
                        testId={`message-avatar-${m.id}`}
                      />
                    )}
                    <div
                      className={cn(
                        "min-w-0",
                        m.sender === "employee"
                          ? "max-w-[calc(100%_-_3rem)] sm:max-w-[calc(75%_-_3rem)]"
                          : "max-w-[88%] sm:max-w-[75%]",
                      )}
                    >
                      <div
                        className={cn(
                          "rounded-2xl px-4 py-3 text-sm shadow-xs",
                          m.attachment && !m.body
                            ? "p-0 shadow-none"
                            : m.sender === "manager"
                              ? "rounded-ss-sm bg-teal-600 text-white"
                              : "rounded-se-sm border border-slate-200 bg-white text-slate-800",
                        )}
                      >
                        {m.attachment && (
                          <MessageAttachmentView
                            attachment={m.attachment}
                            src={`${getApiOrigin()}/api/messages/${encodeURIComponent(m.id)}/attachment`}
                          />
                        )}
                        {m.body && <p className="whitespace-pre-wrap leading-relaxed">{m.body}</p>}
                      </div>
                      <p
                        className={cn(
                          "mt-1.5 px-1 text-[10px] text-slate-500",
                          m.sender === "manager" && "text-teal-700",
                        )}
                      >
                        {m.sender === "manager" ? "الإدارة" : m.sender_name} ·{" "}
                        {fmtDate(m.created_at.slice(0, 10))} {timeOf(m.created_at)}
                      </p>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <footer className="shrink-0 border-t border-slate-100 bg-white p-3 sm:p-4">
            {broadcastMode && (
              <div className="mb-3 flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3 text-xs text-amber-800">
                <Megaphone className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <p className="font-semibold">إرسال جماعي للفريق</p>
                  <p className="mt-0.5">ستصل الرسالة إلى محادثة كل موظف نشِط على حدة.</p>
                </div>
              </div>
            )}
            <MessageComposer
              key={`${active.thread}-${active.employeeId}`}
              placeholder={broadcastMode ? "رسالة لكل الموظفين..." : "اكتب رسالتك..."}
              isPending={sending}
              testIdPrefix="message"
              allowAttachments={!broadcastMode}
              onSend={sendMessage}
            />
          </footer>
        </section>
      </div>
    </FadeIn>
  );
}
