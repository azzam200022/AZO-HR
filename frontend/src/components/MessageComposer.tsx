import { useEffect, useRef, useState, type FormEvent, type ChangeEvent } from "react";
import { ImagePlus, Mic, Paperclip, Send, Square, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { preparePhotoData } from "@/lib/photo-upload";
import type { MessageAttachmentUpload } from "@/lib/types";

const MAX_AUDIO_BYTES = 5 * 1024 * 1024;
const MAX_RECORDING_MS = 2 * 60 * 1000;
const AUDIO_MIME_TYPES = new Set([
  "audio/aac",
  "audio/3gpp",
  "audio/m4a",
  "audio/mp4",
  "audio/mpeg",
  "audio/ogg",
  "audio/wav",
  "audio/webm",
  "audio/x-m4a",
  "audio/x-wav",
]);
const RECORDING_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/mp4",
  "audio/ogg;codecs=opus",
];

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

function normalizeMimeType(mimeType: string) {
  return mimeType.split(";", 1)[0].trim().toLowerCase();
}

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("تعذرت معالجة المرفق"));
    };
    reader.onerror = () => reject(new Error("تعذرت قراءة المرفق"));
    reader.readAsDataURL(blob);
  });
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
  const [isRecording, setIsRecording] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recordingTimerRef = useRef<number | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const canRecordAudio =
    typeof window !== "undefined" &&
    typeof MediaRecorder !== "undefined" &&
    Boolean(navigator.mediaDevices?.getUserMedia);

  useEffect(() => {
    if (allowAttachments) return;
    setAttachment(null);
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
  }, [allowAttachments]);

  useEffect(
    () => () => {
      if (recordingTimerRef.current !== null) {
        window.clearTimeout(recordingTimerRef.current);
      }
      const recorder = recorderRef.current;
      if (recorder) {
        recorder.ondataavailable = null;
        recorder.onstop = null;
        if (recorder.state !== "inactive") recorder.stop();
      }
      streamRef.current?.getTracks().forEach((track) => track.stop());
    },
    [],
  );

  const handleImageChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    try {
      const dataUrl = await preparePhotoData(file);
      setAttachment({ kind: "image", mime_type: "image/jpeg", data_url: dataUrl });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "تعذر تجهيز الصورة");
    }
  };

  const handleAudioChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;

    const mimeType = normalizeMimeType(file.type);
    if (!AUDIO_MIME_TYPES.has(mimeType)) {
      toast.error("اختر مقطعاً صوتياً بصيغة مدعومة");
      return;
    }
    if (file.size > MAX_AUDIO_BYTES) {
      toast.error("يجب ألا يتجاوز حجم المقطع الصوتي 5 ميغابايت");
      return;
    }

    try {
      setAttachment({
        kind: "audio",
        mime_type: mimeType,
        data_url: await readAsDataUrl(file),
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "تعذر قراءة المقطع الصوتي");
    }
  };

  const stopRecording = () => {
    if (recordingTimerRef.current !== null) {
      window.clearTimeout(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
  };

  const startRecording = async () => {
    if (!canRecordAudio) {
      toast.error("التسجيل غير متاح على هذا الجهاز؛ اختر ملفاً صوتياً بدلاً منه");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = RECORDING_MIME_TYPES.find((candidate) =>
        MediaRecorder.isTypeSupported(candidate),
      );
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      streamRef.current = stream;
      recorderRef.current = recorder;
      chunksRef.current = [];
      setAttachment(null);

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const recordedType = normalizeMimeType(recorder.mimeType || mimeType || "");
        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || mimeType || recordedType,
        });
        chunksRef.current = [];
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        recorderRef.current = null;
        setIsRecording(false);

        if (blob.size === 0) {
          toast.error("لم يُسجّل أي صوت");
          return;
        }
        if (blob.size > MAX_AUDIO_BYTES) {
          toast.error("حجم التسجيل أكبر من 5 ميغابايت؛ سجّل مقطعاً أقصر");
          return;
        }
        if (!AUDIO_MIME_TYPES.has(recordedType)) {
          toast.error("صيغة التسجيل غير مدعومة؛ اختر ملفاً صوتياً بدلاً منه");
          return;
        }
        void readAsDataUrl(blob)
          .then((dataUrl) =>
            setAttachment({ kind: "audio", mime_type: recordedType, data_url: dataUrl }),
          )
          .catch((error) =>
            toast.error(error instanceof Error ? error.message : "تعذرت معالجة التسجيل"),
          );
      };
      recorder.onerror = () => {
        toast.error("تعذر تسجيل الصوت");
        if (recorder.state !== "inactive") recorder.stop();
      };

      recorder.start(1000);
      setIsRecording(true);
      recordingTimerRef.current = window.setTimeout(() => {
        toast.info("أُوقف التسجيل بعد دقيقتين");
        stopRecording();
      }, MAX_RECORDING_MS);
    } catch {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      recorderRef.current = null;
      setIsRecording(false);
      toast.error("تعذر الوصول إلى الميكروفون؛ يمكنك اختيار ملف صوتي بدلاً منه");
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
      // The mutation shows its own error; keep the draft and attachment for retry.
    }
  };

  const sendingDisabled = isPending || isRecording;

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
            data-testid={`${testIdPrefix}-image-input`}
          />
          <input
            ref={audioInputRef}
            className="sr-only"
            type="file"
            accept="audio/*"
            onChange={handleAudioChange}
            data-testid={`${testIdPrefix}-audio-input`}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => imageInputRef.current?.click()}
              disabled={sendingDisabled}
              data-testid={`${testIdPrefix}-attach-image-btn`}
            >
              <ImagePlus className="h-3.5 w-3.5" />
              صورة
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => audioInputRef.current?.click()}
              disabled={sendingDisabled}
              data-testid={`${testIdPrefix}-attach-audio-btn`}
            >
              <Paperclip className="h-3.5 w-3.5" />
              ملف صوتي
            </Button>
            <Button
              type="button"
              variant={isRecording ? "destructive" : "outline"}
              size="sm"
              onClick={isRecording ? stopRecording : startRecording}
              disabled={isPending || (!isRecording && !canRecordAudio)}
              data-testid={`${testIdPrefix}-record-audio-btn`}
            >
              {isRecording ? (
                <>
                  <Square className="h-3.5 w-3.5" />
                  إيقاف التسجيل
                </>
              ) : (
                <>
                  <Mic className="h-3.5 w-3.5" />
                  تسجيل صوت
                </>
              )}
            </Button>
            {isRecording && (
              <span className="text-xs font-medium text-rose-700" role="status">
                جارٍ التسجيل…
              </span>
            )}
          </div>
          {attachment && (
            <div
              className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-2"
              data-testid={`${testIdPrefix}-attachment-preview`}
            >
              {attachment.kind === "image" ? (
                <img
                  src={attachment.data_url}
                  alt="معاينة الصورة المرفقة"
                  className="h-16 w-16 rounded-lg object-cover"
                />
              ) : (
                <div className="min-w-0 flex-1">
                  <p className="mb-1 text-xs font-semibold text-slate-700">معاينة الرسالة الصوتية</p>
                  <audio
                    controls
                    preload="metadata"
                    src={attachment.data_url}
                    className="max-w-full"
                  />
                </div>
              )}
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => setAttachment(null)}
                aria-label="إزالة المرفق"
                data-testid={`${testIdPrefix}-remove-attachment-btn`}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          )}
        </>
      )}
      <div className="flex items-end gap-2 sm:gap-3">
        <Textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={placeholder}
          rows={2}
          maxLength={2000}
          className="min-h-[4.5rem] flex-1 resize-none rounded-xl bg-slate-50/60 text-sm"
          data-testid={`${testIdPrefix}-input`}
        />
        <Button
          type="submit"
          disabled={sendingDisabled || (!draft.trim() && !attachment)}
          className="h-10 shrink-0 rounded-xl px-4 sm:h-11"
          aria-label="إرسال الرسالة"
          data-testid={`${testIdPrefix}-send-btn`}
        >
          <Send className="h-4 w-4" />
          إرسال
        </Button>
      </div>
    </form>
  );
}
