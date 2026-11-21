import type { MessageAttachment } from "@/lib/types";

export default function MessageAttachmentView({
  attachment,
  src,
}: {
  attachment: MessageAttachment;
  src: string;
}) {
  if (attachment.kind === "image") {
    return (
      <img
        src={src}
        alt="صورة مرفقة"
        loading="lazy"
        className="mb-2 block max-h-72 max-w-full rounded-lg object-contain"
        data-testid="message-image-attachment"
      />
    );
  }

  return (
    <div className="mb-2 max-w-full">
      <p className="mb-1 text-xs font-semibold">رسالة صوتية</p>
      <audio
        controls
        preload="metadata"
        src={src}
        className="max-w-full"
        data-testid="message-audio-attachment"
      />
    </div>
  );
}
