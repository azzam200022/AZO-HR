// Auth context. The session is an httpOnly cookie set by the backend; the client never
// holds a token and never decides a role — GET /auth/me is the single source of truth.
import { createContext, useContext, useEffect, useLayoutEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost } from "@/lib/api";
import { stopBackgroundLocationTracking } from "@/lib/background-location";
import { bindCurrentPushToken, unregisterCurrentPushToken } from "@/lib/push";
import type { SessionInfo } from "@/lib/types";
import {
  applyTheme,
  getSavedTheme,
  getThemeStorageKey,
  saveTheme,
  type AppTheme,
} from "@/lib/theme";

export type Role = "manager" | "employee";

interface AuthContextValue {
  session: SessionInfo | undefined;
  isLoading: boolean;
  sessionCheckUnavailable: boolean;
  retrySessionCheck: () => void;
  role: Role | null;
  logout: () => void;
  theme: AppTheme;
  setTheme: (theme: AppTheme) => void;
}

const AuthContext = createContext<AuthContextValue>({
  session: undefined,
  isLoading: true,
  sessionCheckUnavailable: false,
  retrySessionCheck: () => {},
  role: null,
  logout: () => {},
  theme: "light",
  setTheme: () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();

  const {
    data: session,
    isPending,
    isError: sessionCheckFailed,
    fetchStatus,
    refetch: refetchSession,
  } = useQuery({
    queryKey: ["session"],
    queryFn: () => apiGet<SessionInfo>("/auth/me"),
    staleTime: 30_000,
    retry: false,
    refetchOnReconnect: "always",
    refetchOnWindowFocus: "always",
  });
  const isLoading = isPending && fetchStatus !== "paused";
  const sessionCheckUnavailable =
    !session?.authenticated && (sessionCheckFailed || fetchStatus === "paused");
  const themeKey = getThemeStorageKey(session);
  const [savedTheme, setSavedTheme] = useState<{ key: string; theme: AppTheme } | null>(null);
  const theme = themeKey && savedTheme?.key === themeKey ? savedTheme.theme : "light";

  useLayoutEffect(() => {
    if (!themeKey) {
      applyTheme("light");
      setSavedTheme(null);
      return;
    }

    const nextTheme = getSavedTheme(themeKey);
    applyTheme(nextTheme);
    setSavedTheme({ key: themeKey, theme: nextTheme });
  }, [themeKey]);

  const setTheme = (nextTheme: AppTheme) => {
    if (!themeKey) return;
    saveTheme(themeKey, nextTheme);
    setSavedTheme({ key: themeKey, theme: nextTheme });
    applyTheme(nextTheme);
  };

  const { mutate: logout } = useMutation({
    mutationFn: async () => {
      await unregisterCurrentPushToken();
      await stopBackgroundLocationTracking();
      return apiPost("/auth/logout");
    },
    onSuccess: () => {
      queryClient.clear();
      queryClient.setQueryData(["session"], { authenticated: false, role: null });
    },
  });

  useEffect(() => {
    document.documentElement.dir = "rtl";
    document.documentElement.lang = "ar";
  }, []);

  useEffect(() => {
    if (session?.authenticated) void bindCurrentPushToken();
  }, [session?.authenticated, session?.role, session?.email, session?.employee_id]);

  const role = session?.authenticated ? (session.role as Role) : null;
  const retrySessionCheck = () => {
    void refetchSession();
  };

  return (
    <AuthContext.Provider
      value={{
        session,
        isLoading,
        sessionCheckUnavailable,
        retrySessionCheck,
        role,
        logout: () => logout(),
        theme,
        setTheme,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);