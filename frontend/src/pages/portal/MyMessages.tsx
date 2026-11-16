import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Send, Users } from "lucide-react";
import MessageAvatar from "@/components/MessageAvatar";
import { apiGet, apiPost, getApiOrigin } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { errorText, fmtDate } from "@/lib/format";
import type { Employee, MarkAllResult, Message } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState, FadeIn, LoadingBlock, PageHeader } from "@/components/shared";
import { cn } from "@/lib/utils";

const timeOf = (iso: string) => {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

/** Employee side: a private thread with the manager plus the read/write team channel. */
export default function MyMessages() {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const [thread, setThread] = useState<"direct" | "group">("direct");
  const [draft, setDraft] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  const profileQuery = useQuery({
    queryKey: ["me", "profile", session?.employee_id],
    queryFn: () => apiGet<Employee>("/me/profile"),
    enabled: Boolean(session?.employee_id),
  });
  const employeeName = profileQuery.data?.name || session?.name || "الموظف";
  const employeePhotoUrl = profileQuery.data?.has_photo
    ? `${getApiOrigin()}/api/me/photo`
    : undefined;

  const messagesQuery = useQuery({
    queryKey: ["me", "messages", thread],
    queryFn: () => apiGet<Message[]>(`/me/messages?thread=${thread}`),
    refetchInterval: 15_000,
  });
  const messages = messagesQuery.data ?? [];

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  const readMutation = useMutation({
    mutationFn: () => apiPost<MarkAllResult>("/me/messages/read", { thread }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["me", "notifications"] }),
  });

  useEffect(() => {
    if (messages.some((m) => !m.read_by_employee)) readMutation.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length, thread]);

  const sendMutation = useMutation({
    mutationFn: () => apiPost<Message>("/me/messages", { thread, body: draft }),
    onSuccess: () => {
      setDraft("");
      queryClient.invalidateQueries({ queryKey: ["me", "messages"] });
    },
    onError: (error) => toast.error(errorText(error)),
  });

  return (
    <FadeIn className="flex min-h-0 flex-col">
      <PageHeader
        title="الرسائل"
        testid="my-messages-title"
      />

      <Tabs value={thread} onValueChange={(v) => setThread(v as "direct" | "group")}>
        <TabsList className="mb-3 w-full" data-testid="my-messages-tabs">
          <TabsTrigger value="direct" className="flex-1" data-testid="tab-direct">
            محادثتي مع الإدارة
          </TabsTrigger>
          <TabsTrigger value="group" className="flex-1" data-testid="tab-group">
            <Users className="h-3.5 w-3.5" />
            مجموعة الفريق
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <section className="flex h-[calc(100dvh_-_21rem)] min-h-[18rem] min-w-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs">
        <header className="flex shrink-0 items-center gap-3 border-b border-slate-100 bg-slate-50/60 px-4 py-3.5">
          {thread === "direct" ? (
            <MessageAvatar
              name={employeeName}
              photoUrl={employeePhotoUrl}
              size="md"
              testId="my-messages-avatar"
            />
          ) : (
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-teal-100 text-teal-700">
              <Users className="h-4 w-4" />
            </span>
          )}
          <p className="truncate text-sm font-bold text-slate-900">
            {thread === "direct" ? "محادثتي مع الإدارة" : "مجموعة الفريق"}
          </p>
        </header>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain bg-slate-50/60 px-3 py-4" data-testid="my-message-list">
          {messagesQuery.isLoading ? (
            <LoadingBlock className="h-40" />
          ) : messages.length === 0 ? (
            <EmptyState
              title="لا توجد رسائل بعد"
              description={
                thread === "direct"
                  ? "اكتب رسالتك للإدارة في الأسفل."
                  : "ستظهر هنا إعلانات الإدارة لكل الفريق."
              }
            />
          ) : (
            messages.map((m) => {
              const isCurrentEmployee =
                m.sender === "employee" && m.employee_id === session?.employee_id;
              return (
                <div
                  key={m.id}
                  className={cn("flex items-end gap-2", m.sender === "employee" ? "justify-end" : "justify-start")}
                  data-testid={`my-message-${m.id}`}
                >
                  {m.sender === "employee" && (
                    <MessageAvatar
                      name={isCurrentEmployee ? employeeName : m.sender_name}
                      photoUrl={isCurrentEmployee ? employeePhotoUrl : undefined}
                      testId={`my-message-avatar-${m.id}`}
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
                        "rounded-2xl px-3.5 py-2.5 text-sm shadow-xs",
                        m.sender === "employee"
                          ? "rounded-se-sm bg-teal-600 text-white"
                          : "rounded-ss-sm bg-slate-100 text-slate-800",
                      )}
                    >
                      <p className="whitespace-pre-wrap leading-relaxed">{m.body}</p>
                      <p
                        className={cn(
                          "mt-1 text-[10px]",
                          m.sender === "employee" ? "text-teal-100" : "text-slate-500",
                        )}
                      >
                        {m.sender === "manager" ? "الإدارة" : m.sender_name} • {fmtDate(m.created_at.slice(0, 10))} {timeOf(m.created_at)}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })
          )}
          <div ref={endRef} />
        </div>

        <footer className="shrink-0 border-t border-slate-100 bg-white p-3 sm:p-4">
          <div className="flex items-end gap-2 sm:gap-3">
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={thread === "direct" ? "اكتب رسالتك للإدارة..." : "شارك الفريق..."}
              rows={2}
              className="min-h-[4.5rem] flex-1 resize-none rounded-xl bg-slate-50/60 text-sm"
              data-testid="my-message-input"
            />
            <Button
              onClick={() => draft.trim() && sendMutation.mutate()}
              disabled={sendMutation.isPending || !draft.trim()}
              className="h-10 shrink-0 rounded-xl px-4 sm:h-11"
              aria-label="إرسال الرسالة"
              data-testid="my-message-send-btn"
            >
              <Send className="h-4 w-4" />
              إرسال
            </Button>
          </div>
        </footer>
      </section>
    </FadeIn>
  );
}
