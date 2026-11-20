const INTERACTIVE_SELECTOR = 'button, a[href], [role="button"], [data-slot="button"]';
const ICON_SELECTOR = "svg, [data-icon]";
const STORAGE_KEY = "azo-hr:icon-click-sound";

let audioContext: AudioContext | null = null;
let soundEnabled = true;
let preferenceLoaded = false;

export function getIconClickSoundEnabled(): boolean {
  if (!preferenceLoaded) {
    if (typeof window !== "undefined") {
      try {
        soundEnabled = window.localStorage.getItem(STORAGE_KEY) !== "false";
      } catch {
        // Keep the default enabled when browser storage is unavailable.
      }
    }
    preferenceLoaded = true;
  }

  return soundEnabled;
}

export function saveIconClickSoundEnabled(enabled: boolean): void {
  soundEnabled = enabled;
  preferenceLoaded = true;

  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(STORAGE_KEY, String(enabled));
    } catch {
      // The in-memory preference still applies until the app is closed.
    }
  }
}

function playSoftClickSound() {
  if (typeof window === "undefined" || typeof window.AudioContext === "undefined") return;
  if (!getIconClickSoundEnabled()) return;

  try {
    const context = audioContext ?? new window.AudioContext();
    audioContext = context;

    if (context.state === "suspended") {
      void context.resume().catch(() => undefined);
    }

    const now = context.currentTime;
    const oscillator = context.createOscillator();
    const gain = context.createGain();

    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(780, now);
    oscillator.frequency.exponentialRampToValueAtTime(560, now + 0.06);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.026, now + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.075);

    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.addEventListener("ended", () => {
      oscillator.disconnect();
      gain.disconnect();
    }, { once: true });
    oscillator.start(now);
    oscillator.stop(now + 0.08);
  } catch {
    // Audio is an enhancement; blocked or unavailable audio must not affect the action.
  }
}

export function installIconClickSound(): () => void {
  const handleClick = (event: MouseEvent) => {
    if (!(event.target instanceof Element)) return;

    const control = event.target.closest(INTERACTIVE_SELECTOR);
    if (
      !control ||
      control.closest("[data-no-click-sound]") ||
      control.matches(":disabled, [aria-disabled='true']") ||
      !control.querySelector(ICON_SELECTOR)
    ) {
      return;
    }

    playSoftClickSound();
  };

  document.addEventListener("click", handleClick, true);
  return () => document.removeEventListener("click", handleClick, true);
}
