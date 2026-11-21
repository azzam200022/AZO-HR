import { useRef, useState, type KeyboardEvent } from "react";
import { Pause, Play } from "lucide-react";

const WAVEFORM_BARS = Array.from({ length: 36 }, (_, index) => {
  const wave = Math.abs(Math.sin(index * 1.73) * Math.cos(index * 0.37));
  return Math.round(5 + wave * 17);
});

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

export function VoiceWaveform({
  progress = 0,
  animated = false,
}: {
  progress?: number;
  animated?: boolean;
}) {
  return (
    <span className="flex h-8 min-w-0 flex-1 items-center justify-center gap-[2px]" aria-hidden="true">
      {WAVEFORM_BARS.map((height, index) => (
        <span
          key={index}
          className={`w-[3px] shrink-0 rounded-full bg-current transition-opacity ${
            animated ? "animate-pulse" : ""
          }`}
          style={{
            height: `${height}px`,
            opacity: index / WAVEFORM_BARS.length <= progress ? 1 : 0.38,
            animationDelay: animated ? `${(index % 8) * 70}ms` : undefined,
          }}
        />
      ))}
    </span>
  );
}

export default function VoiceMessagePlayer({ src }: { src: string }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const progress = duration > 0 ? currentTime / duration : 0;

  const seekToPointer = (clientX: number, element: HTMLElement) => {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(audio.duration) || audio.duration <= 0) return;
    const bounds = element.getBoundingClientRect();
    const position = Math.min(1, Math.max(0, (clientX - bounds.left) / bounds.width));
    audio.currentTime = position * audio.duration;
    setCurrentTime(audio.currentTime);
  };

  const handleWaveformKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(audio.duration) || audio.duration <= 0) return;
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const direction = event.key === "ArrowRight" ? 1 : -1;
    audio.currentTime = Math.min(audio.duration, Math.max(0, audio.currentTime + direction * 5));
    setCurrentTime(audio.currentTime);
  };

  const togglePlayback = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      void audio.play().catch(() => setIsPlaying(false));
    } else {
      audio.pause();
    }
  };

  return (
    <div className="flex min-w-[13rem] max-w-full items-center gap-2.5 py-1" data-testid="voice-message-player">
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        className="hidden"
        onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)}
        onDurationChange={(event) => setDuration(event.currentTarget.duration)}
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => {
          setIsPlaying(false);
          setCurrentTime(0);
        }}
        data-testid="message-audio-attachment"
      />
      <button
        type="button"
        onClick={togglePlayback}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-teal-700 text-white transition-colors hover:bg-teal-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2"
        aria-label={isPlaying ? "إيقاف الرسالة الصوتية مؤقتاً" : "تشغيل الرسالة الصوتية"}
      >
        {isPlaying ? <Pause className="h-4 w-4" fill="currentColor" /> : <Play className="h-4 w-4" fill="currentColor" />}
      </button>
      <div
        className="flex min-w-0 flex-1 cursor-pointer items-center"
        role="slider"
        tabIndex={0}
        aria-label="موضع الرسالة الصوتية"
        aria-valuemin={0}
        aria-valuemax={Math.floor(duration)}
        aria-valuenow={Math.floor(currentTime)}
        onClick={(event) => seekToPointer(event.clientX, event.currentTarget)}
        onKeyDown={handleWaveformKeyDown}
      >
        <VoiceWaveform progress={progress} />
      </div>
      <span className="min-w-[2.5rem] text-[11px] tabular-nums opacity-75" aria-live="off">
        {formatTime(isPlaying || currentTime > 0 ? currentTime : duration)}
      </span>
    </div>
  );
}
