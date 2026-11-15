import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

interface EmployeeAvatarProps {
  name: string;
  photoUrl?: string;
  size?: "sm" | "md";
  testId?: string;
}

export default function EmployeeAvatar({
  name,
  photoUrl,
  size = "sm",
  testId,
}: EmployeeAvatarProps) {
  const [open, setOpen] = useState(false);
  const [imageError, setImageError] = useState(false);
  const sizeClass = size === "md" ? "h-10 w-10" : "h-9 w-9";
  const initial = name.trim().slice(0, 1) || "؟";

  useEffect(() => setImageError(false), [photoUrl]);

  if (!photoUrl || imageError) {
    return (
      <span
        className={cn(
          "flex shrink-0 items-center justify-center rounded-full bg-teal-50 text-sm font-bold text-teal-700",
          sizeClass,
        )}
        aria-hidden="true"
        data-testid={testId}
      >
        {initial}
      </span>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "shrink-0 overflow-hidden rounded-full bg-slate-100 ring-1 ring-slate-200 transition hover:ring-2 hover:ring-teal-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600",
          sizeClass,
        )}
        aria-label={`تكبير صورة ${name}`}
        title="اضغط لتكبير الصورة"
        data-testid={testId}
      >
        <img
          src={photoUrl}
          alt=""
          className="h-full w-full object-cover"
          loading="lazy"
          onError={() => setImageError(true)}
        />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="max-h-[calc(100dvh-2rem)] max-w-md overflow-y-auto"
          data-testid={testId ? `${testId}-dialog` : undefined}
        >
          <DialogHeader>
            <DialogTitle>صورة {name}</DialogTitle>
            <DialogDescription>صورة الموظف بالحجم الكامل.</DialogDescription>
          </DialogHeader>
          <img
            src={photoUrl}
            alt={`صورة ${name}`}
            className="mx-auto max-h-[70dvh] w-full rounded-xl object-contain"
            onError={() => setImageError(true)}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
