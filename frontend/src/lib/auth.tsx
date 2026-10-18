// Auth context. The session is an httpOnly cookie set by the backend; the client never
// holds a token and never decides a role — GET /auth/me is the single source of truth.
import { createContext, useContext, useEffect, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost } from "@/lib/api";
import type { SessionInfo } from "@/lib/types";

export type Role = "manager" | "employee";

interface AuthContextValue {
  session: SessionInfo | undefined;
  isLoading: boolean;
  role: Role | null;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue>({
  session: undefined,
  isLoading: true,
  role: null,
  logout: () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();

  const { data: session, isLoading } = useQuery({
    queryKey: ["session"],
    queryFn: () => apiGet<SessionInfo>("/auth/me"),
    staleTime: 30_000,
    retry: false,
  });

  const { mutate: logout } = useMutation({
    mutationFn: () => apiPost("/auth/logout"),
    onSuccess: () => {
      queryClient.clear();
      queryClient.setQueryData(["session"], { authenticated: false, role: null });
    },
  });

  useEffect(() => {
    document.documentElement.dir = "rtl";
    document.documentElement.lang = "ar";
  }, []);

  const role = session?.authenticated ? (session.role as Role) : null;

  return (
    <AuthContext.Provider value={{ session, isLoading, role, logout: () => logout() }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);