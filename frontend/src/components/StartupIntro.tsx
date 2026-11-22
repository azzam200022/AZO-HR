import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth";

export default function StartupIntro() {
  const { isLoading } = useAuth();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoReady, setVideoReady] = useState(false);
  const [videoStarted, setVideoStarted] = useState(false);
  const [videoFinished, setVideoFinished] = useState(false);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const [isOnline, setIsOnline] = useState(
    () => typeof navigator === "undefined" || navigator.onLine,
  );

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let active = true;
    void video.play().then(
      () => {
        if (active) setAutoplayBlocked(false);
      },
      () => {
        if (active) setAutoplayBlocked(true);
      },
    );

    return () => {
      active = false;
      video.pause();
    };
  }, []);

  const startVideo = () => {
    const video = videoRef.current;
    if (!video) return;

    void video.play().then(
      () => setAutoplayBlocked(false),
      () => setAutoplayBlocked(true),
    );
  };

  const showIntro = !videoFinished || isLoading || !isOnline;
  if (!showIntro) return null;

  const showSpinner = !videoReady || isLoading || !isOnline;

  return (
    <div
      className="fixed inset-0 z-[100] overflow-hidden bg-slate-950"
      dir="rtl"
      role="dialog"
      aria-label="مقدمة التطبيق"
    >
      {!videoFinished && (
        <video
          ref={videoRef}
          className="h-full w-full object-cover"
          src={`${import.meta.env.BASE_URL}app-intro.mp4`}
          autoPlay
          playsInline
          preload="auto"
          aria-label="مقدمة تطبيق مواردي"
          onCanPlay={() => setVideoReady(true)}
          onPlay={() => setVideoStarted(true)}
          onEnded={() => setVideoFinished(true)}
          onError={() => setVideoFinished(true)}
        />
      )}

      {!videoStarted && !videoFinished && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-slate-950/55 px-6 text-center">
          <p className="max-w-xs text-sm leading-6 text-white">
            {autoplayBlocked && videoReady
              ? "اضغط لبدء مقدمة التطبيق بالصوت."
              : "جارٍ تجهيز المقدمة بالصوت…"}
          </p>
          {autoplayBlocked && videoReady && (
            <button
              type="button"
              className="rounded-xl bg-white px-5 py-3 text-sm font-bold text-slate-900"
              onClick={startVideo}
            >
              تشغيل المقدمة بالصوت
            </button>
          )}
        </div>
      )}

      {!videoFinished && (
        <button
          type="button"
          className="absolute right-4 top-5 z-10 rounded-full bg-black/40 px-4 py-2 text-sm font-medium text-white backdrop-blur-sm"
          onClick={() => setVideoFinished(true)}
        >
          تخطي
        </button>
      )}

      {videoFinished && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-950">
          <p className="px-6 text-center text-sm text-white/75">
            {isOnline ? "جارٍ تجهيز التطبيق…" : "بانتظار اتصال الإنترنت…"}
          </p>
        </div>
      )}

      {showSpinner && (
        <div
          className="absolute bottom-8 left-1/2 flex -translate-x-1/2 flex-col items-center gap-3 text-white"
          role="status"
          aria-live="polite"
        >
          <span className="h-8 w-8 animate-spin rounded-full border-4 border-white/30 border-t-white" />
          <span className="sr-only">جارٍ التحميل</span>
        </div>
      )}
    </div>
  );
}
