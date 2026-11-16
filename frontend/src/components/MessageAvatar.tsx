import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

interface MessageAvatarProps {
  name: string;
  photoUrl?: string;
  size?: "sm" | "md";
  className?: string;
  testId?: string;
}

export default function MessageAvatar({
  name,
  photoUrl,
  size = "sm",
  className,
  testId,
}: MessageAvatarProps) {
  const [imageError, setImageError] = useState(false);
  const initial = name.trim().slice(0, 1) || "؟";

  useEffect(() => setImageError(false), [photoUrl]);

  return (
    <span
      role="img"
      aria-label={name}
      data-testid={testId}
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-teal-50 text-sm font-bold text-teal-700 ring-1 ring-slate-200",
        size === "md" ? "h-10 w-10" : "h-9 w-9",
        className,
      )}
    >
      {photoUrl && !imageError ? (
        <img
          src={photoUrl}
          alt=""
          className="h-full w-full object-cover"
          loading="lazy"
          onError={() => setImageError(true)}
        />
      ) : (
        initial
      )}
    </span>
  );
}
