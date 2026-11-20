import type { SessionInfo } from "@/lib/types";

export type AuthScreenState = "loading" | "unavailable" | "login" | "authenticated";

export function getAuthScreenState(
  isLoading: boolean,
  sessionCheckUnavailable: boolean,
  session: SessionInfo | undefined,
): AuthScreenState {
  if (sessionCheckUnavailable && !session?.authenticated) return "unavailable";
  if (isLoading) return "loading";
  if (!session?.authenticated) return "login";
  return "authenticated";
}
