import { useEffect, useRef, useState } from "react";
import { BarcodeScanner, GoogleBarcodeScannerModuleInstallState } from "@capacitor-mlkit/barcode-scanning";
import { Capacitor, type PluginListenerHandle } from "@capacitor/core";
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

function nativeScannerErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (message.includes("unsupported")) {
    return "هذا الجهاز لا يدعم ماسح الباركود الأصلي. حدّث خدمات Google Play أو أدخل الرمز يدويًا.";
  }
  return "تعذّر تجهيز ماسح الباركود. تحقق من اتصال الإنترنت وتحديث خدمات Google Play ثم أعد المحاولة.";
}

function waitForGoogleScannerModule(
  onProgress: (progress?: number) => void,
  registerCancel: (cancel: () => void) => void,
) {
  return new Promise<void>((resolve, reject) => {
    let listener: PluginListenerHandle | undefined;
    let timeoutId: number | undefined;
    let settled = false;

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
      void listener?.remove();
      if (error) reject(error);
      else resolve();
    };

    registerCancel(() => finish(new Error("cancelled")));
    timeoutId = window.setTimeout(() => finish(new Error("timeout")), 120_000);

    void BarcodeScanner.addListener("googleBarcodeScannerModuleInstallProgress", (event) => {
      if (event.state === GoogleBarcodeScannerModuleInstallState.COMPLETED) {
        finish();
        return;
      }
      if (
        event.state === GoogleBarcodeScannerModuleInstallState.FAILED ||
        event.state === GoogleBarcodeScannerModuleInstallState.CANCELED
      ) {
        finish(new Error("module_install_failed"));
        return;
      }
      onProgress(event.progress);
    })
      .then((handle) => {
        listener = handle;
        if (settled) {
          void handle.remove();
          return;
        }
        return BarcodeScanner.installGoogleBarcodeScannerModule().catch(() => {
          finish(new Error("module_install_failed"));
        });
      })
      .catch(() => finish(new Error("module_install_failed")));
  });
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
  const [startingText, setStartingText] = useState("جارٍ تشغيل الكاميرا…");

  callbacksRef.current = { onOpenChange, onDetected };

  useEffect(() => {
    if (!open) {
      setError(null);
      setStarting(false);
      setStartingText("جارٍ تشغيل الكاميرا…");
      return;
    }

    let active = true;
    setError(null);

    if (Capacitor.getPlatform() === "android") {
      let cancelModuleInstall = () => {};
      setStarting(true);
      setStartingText("جارٍ تجهيز ماسح الباركود…");

      const runNativeScan = async () => {
        try {
          const { supported } = await BarcodeScanner.isSupported();
          if (!active) return;
          if (!supported) throw new Error("unsupported_device");

          const { available } = await BarcodeScanner.isGoogleBarcodeScannerModuleAvailable();
          if (!active) return;
          if (!available) {
            setStartingText("جارٍ تنزيل الماسح لأول مرة…");
            await waitForGoogleScannerModule(
              (progress) => {
                if (!active) return;
                setStartingText(
                  typeof progress === "number"
                    ? "جارٍ تنزيل الماسح (" + Math.round(progress) + "٪)…"
                    : "جارٍ تنزيل الماسح لأول مرة…",
                );
              },
              (cancel) => {
                cancelModuleInstall = cancel;
              },
            );
          }
          if (!active) return;

          setStartingText("وجّه الكاميرا إلى الباركود…");
          const { barcodes } = await BarcodeScanner.scan();
          if (!active) return;

          const barcode = barcodes.find((item) => item.rawValue?.trim())?.rawValue?.trim();
          if (barcode) callbacksRef.current.onDetected(barcode);
          callbacksRef.current.onOpenChange(false);
        } catch (cause: unknown) {
          if (!active) return;
          setStarting(false);
          setError(nativeScannerErrorMessage(cause));
        }
      };

      void runNativeScan();
      return () => {
        active = false;
        cancelModuleInstall();
      };
    }

    const video = videoRef.current;
    if (!video) return;

    let controls: { stop: () => void } | undefined;
    const reader = new BrowserMultiFormatReader();
    setStarting(true);
    setStartingText("جارٍ تشغيل الكاميرا…");

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
                {startingText}
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
