import { useState } from "react";
import { Volume2, VolumeX } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  getIconClickSoundEnabled,
  saveIconClickSoundEnabled,
} from "@/lib/icon-click-sound";

export default function IconClickSoundToggle() {
  const [enabled, setEnabled] = useState(getIconClickSoundEnabled);
  const label = enabled ? "إيقاف صوت الأيقونات" : "تشغيل صوت الأيقونات";

  const toggle = () => {
    const nextEnabled = !enabled;
    saveIconClickSoundEnabled(nextEnabled);
    setEnabled(nextEnabled);
  };

  return (
    <Button
      type="button"
      size="icon-sm"
      variant="ghost"
      onClick={toggle}
      aria-label={label}
      aria-pressed={enabled}
      title={label}
      data-testid="icon-sound-toggle"
      data-no-click-sound
      className="shrink-0"
    >
      {enabled ? (
        <Volume2 className="h-4 w-4" aria-hidden="true" />
      ) : (
        <VolumeX className="h-4 w-4" aria-hidden="true" />
      )}
    </Button>
  );
}
