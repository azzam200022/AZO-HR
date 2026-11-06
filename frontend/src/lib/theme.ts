import type { SessionInfo } from "@/lib/types";

export type AppTheme = "light" | "dark";

export function getThemeStorageKey(session: SessionInfo | undefined): string | null {
  if (!session?.authenticated || !session.role) return null;

  const identity =
    session.role === "employee"
      ? session.employee_id || session.email
      : session.email;
  if (!identity) return null;

  return `azo-hr-theme:${session.role}:${identity.trim().toLowerCase()}`;
}

export function getSavedTheme(key: string): AppTheme {
  try {
    return window.localStorage.getItem(key) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

export function saveTheme(key: string, theme: AppTheme): void {
  try {
    window.localStorage.setItem(key, theme);
  } catch {
    // The in-memory selection still applies when browser storage is unavailable.
  }
}

export function applyTheme(theme: AppTheme): void {
  document.documentElement.classList.toggle("dark", theme === "dark");
  document.documentElement.style.colorScheme = theme;
}
