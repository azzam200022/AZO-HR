import { useEffect, useState } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { arSA } from "date-fns/locale";
import { CalendarDays, Clock, LayoutDashboard, UserRound, Users, Wallet } from "lucide-react";
import { useRole, type Role } from "@/lib/role";
import { cn } from "@/lib/utils";

const MANAGER_NAV = [
  { to: "/", label: "لوحة التحكم", icon: LayoutDashboard, testid: "nav-dashboard" },
  { to: "/employees", label: "الموظفون", icon: Users, testid: "nav-employees" },
  { to: "/attendance", label: "الحضور", icon: Clock, testid: "nav-attendance" },
  { to: "/leaves", label: "الإجازات", icon: CalendarDays, testid: "nav-leaves" },
  { to: "/payroll", label: "الرواتب", icon: Wallet, testid: "nav-payroll" },
];

const EMPLOYEE_NAV = [{ to: "/me", label: "بوابة الموظف", icon: UserRound, testid: "nav-my-portal" }];

export default function Navbar() {
  const { role, setRole } = useRole();
  const navigate = useNavigate();
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const items = role === "manager" ? MANAGER_NAV : EMPLOYEE_NAV;

  const switchRole = (next: Role) => {
    setRole(next);
    navigate(next === "manager" ? "/" : "/me");
  };

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/85 shadow-xs backdrop-blur-md">
      <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3 md:gap-6 md:px-8">
        <Link to="/" data-testid="brand-link" className="flex shrink-0 items-center gap-2.5">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-teal-500 to-teal-700 text-white shadow-sm">
            <Users className="h-5 w-5" />
          </span>
          <span className="leading-tight">
            <span className="block text-base font-extrabold tracking-tight text-slate-900">مواردي</span>
            <span className="block text-[11px] font-medium text-slate-500">إدارة الموارد البشرية</span>
          </span>
        </Link>

        <nav className="hidden flex-1 items-center gap-1 md:flex">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              data-testid={item.testid}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-teal-50 text-teal-700"
                    : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
                )
              }
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="ms-auto flex items-center gap-3 md:ms-0">
          <span className="hidden text-xs font-medium text-slate-500 xl:block" data-testid="header-date">
            {format(now, "EEEE، d MMMM yyyy", { locale: arSA })}
          </span>
          <div className="flex items-center rounded-full bg-slate-100 p-1" data-testid="role-switcher">
            <button
              type="button"
              data-testid="role-switcher-manager"
              onClick={() => switchRole("manager")}
              className={cn(
                "rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all active:scale-[0.98]",
                role === "manager"
                  ? "bg-slate-900 text-white shadow-sm"
                  : "text-slate-500 hover:text-slate-800",
              )}
            >
              مدير النظام
            </button>
            <button
              type="button"
              data-testid="role-switcher-employee"
              onClick={() => switchRole("employee")}
              className={cn(
                "rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all active:scale-[0.98]",
                role === "employee"
                  ? "bg-emerald-700 text-white shadow-sm"
                  : "text-slate-500 hover:text-slate-800",
              )}
            >
              بوابة الموظف
            </button>
          </div>
        </div>
      </div>

      <nav className="flex gap-1 overflow-x-auto border-t border-slate-100 px-4 py-2 md:hidden">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === "/"}
            data-testid={`${item.testid}-mobile`}
            className={({ isActive }) =>
              cn(
                "flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
                isActive ? "bg-teal-50 text-teal-700" : "text-slate-600",
              )
            }
          >
            <item.icon className="h-3.5 w-3.5" />
            {item.label}
          </NavLink>
        ))}
      </nav>
    </header>
  );
}