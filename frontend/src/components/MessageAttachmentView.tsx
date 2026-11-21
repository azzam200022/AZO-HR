import { useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import type { MessageAttachment } from "@/lib/types";
import VoiceMessagePlayer from "@/components/VoiceMessagePlayer";

export default function MessageAttachmentView({
  attachment,
  src,
}: {
  attachment: MessageAttachment;
  src: string;
}) {
  const [imageOpen, setImageOpen] = useState(false);

  if (attachment.kind === "image") {
    return (
      <>
        <button
          type="button"
          onClick={() => setImageOpen(true)}
          className="mb-1 block max-w-full overflow-hidden rounded-xl text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
          aria-label="فتح الصورة بالحجم الكامل"
          data-testid="message-image-open"
        >
          <img
            src={src}
            alt="صورة مرفقة — اضغط لفتحها بالحجم الكامل"
            loading="lazy"
            className="block max-h-72 max-w-full rounded-xl object-contain"
            data-testid="message-image-attachment"
          />
        </button>
        <Dialog open={imageOpen} onOpenChange={setImageOpen}>
          <DialogContent
            className="fixed left-0 top-0 flex h-dvh w-screen max-w-none translate-x-0 translate-y-0 items-center justify-center rounded-none border-0 bg-black/95 p-3 text-white shadow-none ring-0 sm:max-w-none"
            data-testid="message-image-viewer"
          >
            <DialogTitle className="sr-only">عرض الصورة بالحجم الكامل</DialogTitle>
            <img
              src={src}
              alt="صورة مرفقة بالحجم الكامل"
              className="max-h-[calc(100dvh-1.5rem)] max-w-full object-contain"
            />
          </DialogContent>
        </Dialog>
      </>
    );
  }

  return (
    <VoiceMessagePlayer src={src} />
  );
}
