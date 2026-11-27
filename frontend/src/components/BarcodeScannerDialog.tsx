import { useEffect, useRef, useState } from "react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import { AlertCircle, Camera, LoaderCircle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface BarcodeScannerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDetected: (barcode: string) => void;
}

function cameraErrorMessage(error: unknown) {
  if (error instanceof Error) {
    if (error.name === "NotAllowedError" || error.name === "PermissionDeniedError") {
      return "اسمح للمتصفح باستخدام الكاميرا، ثم افتح المسح مرة أخرى.";
    }
    if (error.name === "NotFoundError" || error.name === "DevicesNotFoundError") {
      return "لم نعثر على كاميرا متاحة في هذا الجهاز.";
    }
    if (error.name === "NotReadableError" || error.name === "TrackStartError") {
      return "الكاميرا مستخدمة حاليًا من تطبيق آخر. أغلقه ثم أعد المحاولة.";
    }
  }
  return "تعذّر تشغيل الكاميرا. تأكد من إذن الكاميرا واتصال آمن بالموقع.";
}

export default function BarcodeScannerDialog({
  open,
  onOpenChange,
  onDetected,
}: BarcodeScannerDialogProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const callbacksRef = useRef({ onOpenChange, onDetected });
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  callbacksRef.current = { onOpenChange, onDetected };

  useEffect(() => {
    if (!open) {
      setError(null);
      setStarting(false);
      return;
    }

    const video = videoRef.current;
    if (!video) return;

    let active = true;
    let controls: { stop: () => void } | undefined;
    const reader = new BrowserMultiFormatReader();
    setError(null);
    setStarting(true);

    void reader
      .decodeFromConstraints(
        { audio: false, video: { facingMode: { ideal: "environment" } } },
        video,
        (result, _scanError, scannerControls) => {
          controls = scannerControls ?? controls;
          if (!active || !result) return;

          const barcode = result.getText().trim();
          if (!barcode) return;

          active = false;
          controls?.stop();
          callbacksRef.current.onDetected(barcode);
          callbacksRef.current.onOpenChange(false);
        },
      )
      .then((scannerControls) => {
        controls = scannerControls;
        if (!active) scannerControls.stop();
        else setStarting(false);
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setStarting(false);
        setError(cameraErrorMessage(cause));
      });

    return () => {
      active = false;
      controls?.stop();
    };
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>مسح باركود المادة</DialogTitle>
          <DialogDescription>
            وجّه الكاميرا الخلفية إلى الرمز حتى تتم قراءته تلقائيًا.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="relative overflow-hidden rounded-xl bg-slate-950">
            <video
              ref={videoRef}
              className="aspect-video w-full object-cover"
              autoPlay
              muted
              playsInline
              aria-label="معاينة كاميرا مسح الباركود"
            />
            {starting && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-slate-950/75 text-sm text-white">
                <LoaderCircle className="h-6 w-6 animate-spin" />
                جارٍ تشغيل الكاميرا…
              </div>
            )}
          </div>
          {error ? (
            <p
              className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800"
              role="alert"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              {error}
            </p>
          ) : (
            <p className="flex items-center gap-2 text-xs text-slate-500">
              <Camera className="h-4 w-4" />
              احتفظ بالرمز داخل إطار الكاميرا وبإضاءة واضحة.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
