import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent, type PointerEvent } from "react";
import { ImagePlus, Mic, Paperclip, Send, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { preparePhotoData } from "@/lib/photo-upload";
import type { MessageAttachmentUpload } from "@/lib/types";
import VoiceMessagePlayer, { VoiceWaveform } from "@/components/VoiceMessagePlayer";

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
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [cancelArmed, setCancelArmed] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recordingTimerRef = useRef<number | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordingStartedAtRef = useRef<number | null>(null);
  const pointerIdRef = useRef<number | null>(null);
  const pointerStartXRef = useRef(0);
  const releasedBeforeReadyRef = useRef(false);
  const cancelRecordingRef = useRef(false);
  const startInProgressRef = useRef(false);
  const canRecordAudio =
    typeof window !== "undefined" &&
    typeof MediaRecorder !== "undefined" &&
    Boolean(navigator.mediaDevices?.getUserMedia);

  useEffect(() => {
    if (allowAttachments) return;
    setAttachment(null);
    cancelRecordingRef.current = true;
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      if (recordingTimerRef.current !== null) {
        window.clearTimeout(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
      recorder.stop();
    } else if (startInProgressRef.current) {
      releasedBeforeReadyRef.current = true;
    }
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

  useEffect(() => {
    if (!isRecording) return;
    const updateElapsed = () => {
      const startedAt = recordingStartedAtRef.current;
      if (startedAt !== null) setRecordingSeconds(Math.floor((Date.now() - startedAt) / 1000));
    };
    updateElapsed();
    const interval = window.setInterval(updateElapsed, 250);
    return () => window.clearInterval(interval);
  }, [isRecording]);

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

  const stopRecording = (cancel = false) => {
    if (recordingTimerRef.current !== null) {
      window.clearTimeout(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    cancelRecordingRef.current = cancel;
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
  };

  const startRecording = async () => {
    if (startInProgressRef.current || recorderRef.current) return;
    if (!canRecordAudio) {
      toast.error("التسجيل غير متاح على هذا الجهاز؛ اختر ملفاً صوتياً بدلاً منه");
      return;
    }

    startInProgressRef.current = true;
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
      recordingStartedAtRef.current = Date.now();
      setRecordingSeconds(0);

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
        recordingStartedAtRef.current = null;

        if (cancelRecordingRef.current) {
          cancelRecordingRef.current = false;
          setAttachment(null);
          return;
        }
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
      startInProgressRef.current = false;
      setIsRecording(true);
      recordingTimerRef.current = window.setTimeout(() => {
        toast.info("أُوقف التسجيل بعد دقيقتين");
        stopRecording();
      }, MAX_RECORDING_MS);
      if (releasedBeforeReadyRef.current) {
        releasedBeforeReadyRef.current = false;
        stopRecording(cancelRecordingRef.current);
      }
    } catch {
      startInProgressRef.current = false;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      recorderRef.current = null;
      recordingStartedAtRef.current = null;
      releasedBeforeReadyRef.current = false;
      setIsRecording(false);
      toast.error("تعذر الوصول إلى الميكروفون؛ يمكنك اختيار ملف صوتي بدلاً منه");
    }
  };

  const beginHoldToRecord = (event: PointerEvent<HTMLButtonElement>) => {
    if (isPending || isRecording || startInProgressRef.current) return;
    event.preventDefault();
    pointerIdRef.current = event.pointerId;
    pointerStartXRef.current = event.clientX;
    releasedBeforeReadyRef.current = false;
    cancelRecordingRef.current = false;
    setCancelArmed(false);
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture is not available in every embedded browser.
    }
    void startRecording();
  };

  const moveHoldToRecord = (event: PointerEvent<HTMLButtonElement>) => {
    if (pointerIdRef.current !== event.pointerId) return;
    const shouldCancel = event.clientX < pointerStartXRef.current - 72;
    setCancelArmed(shouldCancel);
    cancelRecordingRef.current = shouldCancel;
  };

  const endHoldToRecord = (event: PointerEvent<HTMLButtonElement>, cancel = false) => {
    if (pointerIdRef.current !== event.pointerId) return;
    pointerIdRef.current = null;
    const shouldCancel = cancel || cancelRecordingRef.current;
    cancelRecordingRef.current = shouldCancel;
    setCancelArmed(false);
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      stopRecording(shouldCancel);
    } else {
      releasedBeforeReadyRef.current = true;
    }
  };

  const handleRecordKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.repeat || startInProgressRef.current || (event.key !== " " && event.key !== "Enter")) return;
    event.preventDefault();
    releasedBeforeReadyRef.current = false;
    cancelRecordingRef.current = false;
    void startRecording();
  };

  const handleRecordKeyUp = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== " " && event.key !== "Enter") return;
    event.preventDefault();
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      stopRecording();
    } else {
      releasedBeforeReadyRef.current = true;
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
          </div>
          {attachment && (
            <div
              className="flex min-w-0 items-center gap-3 px-1 py-2"
              data-testid={`${testIdPrefix}-attachment-preview`}
            >
              {attachment.kind === "image" ? (
                <img
                  src={attachment.data_url}
                  alt="معاينة الصورة المرفقة"
                  className="max-h-24 max-w-28 rounded-xl object-contain"
                />
              ) : (
                <div className="min-w-0 flex-1">
                  <VoiceMessagePlayer src={attachment.data_url} />
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
      <div className="flex min-w-0 items-end gap-2 sm:gap-3">
        <div className="flex min-h-[3.25rem] min-w-0 flex-1 items-center rounded-2xl border border-slate-200 bg-slate-50/60 px-3 py-2 focus-within:border-teal-400 focus-within:ring-2 focus-within:ring-teal-500/15">
          {isRecording ? (
            <div className="flex min-w-0 flex-1 items-center gap-3 px-1" role="status" aria-live="polite">
              <VoiceWaveform animated />
              <span className={`shrink-0 text-xs font-semibold ${cancelArmed ? "text-rose-600" : "text-slate-500"}`}>
                {cancelArmed ? "اترك للإلغاء" : `حرّر للإيقاف · ${Math.floor(recordingSeconds / 60)}:${String(recordingSeconds % 60).padStart(2, "0")}`}
              </span>
            </div>
          ) : (
            <Textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={placeholder}
              rows={2}
              maxLength={2000}
              className="min-h-[2.5rem] flex-1 resize-none border-0 bg-transparent px-1 py-1 text-sm shadow-none focus-visible:ring-0"
              data-testid={`${testIdPrefix}-input`}
            />
          )}
          {allowAttachments && !draft.trim() && !attachment ? (
            <Button
              type="button"
              variant={isRecording ? "destructive" : "default"}
              size="icon"
              onPointerDown={beginHoldToRecord}
              onPointerMove={moveHoldToRecord}
              onPointerUp={(event) => endHoldToRecord(event)}
              onPointerCancel={(event) => endHoldToRecord(event, true)}
              onKeyDown={handleRecordKeyDown}
              onKeyUp={handleRecordKeyUp}
              onContextMenu={(event) => event.preventDefault()}
              disabled={isPending || (!isRecording && !canRecordAudio)}
              className="h-10 w-10 shrink-0 rounded-full touch-none"
              aria-label="اضغط مطولاً لتسجيل رسالة صوتية؛ حرّر للإيقاف أو اسحب لليسار للإلغاء"
              title="اضغط مطولاً للتسجيل، واسحب لليسار للإلغاء"
              data-testid={`${testIdPrefix}-record-audio-btn`}
            >
              {isRecording ? <span className="h-3 w-3 rounded-sm bg-white" /> : <Mic className="h-4 w-4" />}
            </Button>
          ) : (
            <Button
              type="submit"
              disabled={sendingDisabled || (!draft.trim() && !attachment)}
              size="icon"
              className="h-10 w-10 shrink-0 rounded-full"
              aria-label="إرسال الرسالة"
              data-testid={`${testIdPrefix}-send-btn`}
            >
              <Send className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </form>
  );
}
