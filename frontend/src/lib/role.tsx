// Role context — the app has no login, but a distinct MANAGER role and EMPLOYEE role
// live in the same app. The choice persists in localStorage and drives the nav + routes.
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type Role = "manager" | "employee";

interface RoleContextValue {
  role: Role;
  setRole: (role: Role) => void;
}

const RoleContext = createContext<RoleContextValue>({ role: "manager", setRole: () => {} });

const STORAGE_KEY = "hr-role";

export function RoleProvider({ children }: { children: ReactNode }) {
  const [role, setRoleState] = useState<Role>(() =>
    localStorage.getItem(STORAGE_KEY) === "employee" ? "employee" : "manager",
  );

  useEffect(() => {
    document.documentElement.dir = "rtl";
    document.documentElement.lang = "ar";
  }, []);

  const setRole = (next: Role) => {
    setRoleState(next);
    localStorage.setItem(STORAGE_KEY, next);
  };

  return <RoleContext.Provider value={{ role, setRole }}>{children}</RoleContext.Provider>;
}

export const useRole = () => useContext(RoleContext);