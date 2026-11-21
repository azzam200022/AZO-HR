import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { ImagePlus, Send, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { prepareMessagePhotoData } from "@/lib/photo-upload";
import type { MessageAttachmentUpload } from "@/lib/types";

export interface MessageComposerPayload {
  body: string;
  attachment?: MessageAttachmentUpload;
}

interface MessageComposerProps {
  placeholder: string;
  isPending: boolean;
  testIdPrefix: string;
  allowAttachments?: boolean;
  onSend: (payload: MessageComposerPayload) => Promise<void>;
}

export default function MessageComposer({
  placeholder,
  isPending,
  testIdPrefix,
  allowAttachments = true,
  onSend,
}: MessageComposerProps) {
  const [draft, setDraft] = useState("");
  const [attachment, setAttachment] = useState<MessageAttachmentUpload | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!allowAttachments) setAttachment(null);
  }, [allowAttachments]);

  const handleImageChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    try {
      const dataUrl = await prepareMessagePhotoData(file);
      setAttachment({ kind: "image", mime_type: "image/jpeg", data_url: dataUrl });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "تعذر تجهيز الصورة");
    }
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const body = draft.trim();
    if (!body && !attachment) return;
    try {
      await onSend({ body, ...(attachment ? { attachment } : {}) });
      setDraft("");
      setAttachment(null);
    } catch {
      // Keep the draft and image available for retry.
    }
  };

  return (
    <form className="space-y-2" onSubmit={submit}>
      {allowAttachments && (
        <>
          <input
            ref={imageInputRef}
            className="sr-only"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={handleImageChange}
            data-testid={testIdPrefix + "-image-input"}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => imageInputRef.current?.click()}
              disabled={isPending}
              data-testid={testIdPrefix + "-attach-image-btn"}
            >
              <ImagePlus className="h-3.5 w-3.5" />
              صورة
            </Button>
          </div>
          {attachment && (
            <div
              className="flex min-w-0 items-center gap-3 px-1 py-2"
              data-testid={testIdPrefix + "-attachment-preview"}
            >
              <img
                src={attachment.data_url}
                alt="معاينة الصورة المرفقة"
                className="max-h-24 max-w-28 rounded-xl object-contain"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => setAttachment(null)}
                aria-label="إزالة الصورة المرفقة"
                data-testid={testIdPrefix + "-remove-attachment-btn"}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          )}
        </>
      )}
      <div className="flex min-w-0 items-end gap-2 sm:gap-3">
        <div className="flex min-h-[3.25rem] min-w-0 flex-1 items-center rounded-2xl border border-slate-200 bg-slate-50/60 px-3 py-2 focus-within:border-teal-400 focus-within:ring-2 focus-within:ring-teal-500/15">
          <Textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={placeholder}
            rows={2}
            maxLength={2000}
            className="min-h-[2.5rem] flex-1 resize-none border-0 bg-transparent px-1 py-1 text-sm shadow-none focus-visible:ring-0"
            data-testid={testIdPrefix + "-input"}
          />
          <Button
            type="submit"
            disabled={isPending || (!draft.trim() && !attachment)}
            size="icon"
            className="h-10 w-10 shrink-0 rounded-full"
            aria-label="إرسال الرسالة"
            data-testid={testIdPrefix + "-send-btn"}
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </form>
  );
}