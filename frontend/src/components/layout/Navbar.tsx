import { useEffect, useState } from "react";
import { Link, NavLink } from "react-router-dom";
import { format } from "date-fns";
import { arSA } from "date-fns/locale";
import {
  CalendarDays,
  Clock,
  LayoutDashboard,
  LogOut,
  MapPin,
  Users,
  Wallet,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const MANAGER_NAV = [
  { to: "/", label: "لوحة التحكم", icon: LayoutDashboard, testid: "nav-dashboard" },
  { to: "/employees", label: "الموظفون", icon: Users, testid: "nav-employees" },
  { to: "/attendance", label: "الحضور", icon: Clock, testid: "nav-attendance" },
  { to: "/leaves", label: "الإجازات", icon: CalendarDays, testid: "nav-leaves" },
  { to: "/payroll", label: "الرواتب", icon: Wallet, testid: "nav-payroll" },
  { to: "/locations", label: "المواقع", icon: MapPin, testid: "nav-locations" },
];

// Employees navigate through the bottom bar, so the top bar carries no links for them.
const EMPLOYEE_NAV: { to: string; label: string; icon: typeof Users; testid: string }[] = [];

export default function Navbar() {
  const { session, role, logout } = useAuth();
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const items = role === "manager" ? MANAGER_NAV : EMPLOYEE_NAV;

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/85 shadow-xs backdrop-blur-md">
      <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3 md:gap-6 md:px-8">
        <Link to={role === "manager" ? "/" : "/me"} data-testid="brand-link" className="flex shrink-0 items-center gap-2.5">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-teal-500 to-teal-700 text-white shadow-sm">
            <Users className="h-5 w-5" />
          </span>
          <span className="leading-tight">
            <span className="block text-base font-extrabold tracking-tight text-slate-900">مواردي</span>
            <span className="block text-[11px] font-medium text-slate-500">إدارة الموارد البشرية</span>
          </span>
        </Link>

        <nav className="hidden flex-1 items-center gap-1 lg:flex">
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

        <div className="ms-auto flex items-center gap-3 lg:ms-0">
          <span className="hidden text-xs font-medium text-slate-500 xl:block" data-testid="header-date">
            {format(now, "EEEE، d MMMM yyyy", { locale: arSA })}
          </span>
          <div className="flex items-center gap-2 rounded-full bg-slate-100 py-1 ps-3 pe-1">
            <span className="text-xs font-semibold text-slate-700" data-testid="current-user-label">
              {session?.name || session?.email || "—"}
              <span className="ms-1.5 text-[10px] font-medium text-slate-500">
                {role === "manager" ? "مدير النظام" : "موظف"}
              </span>
            </span>
            <Button
              size="icon-sm"
              variant="ghost"
              onClick={logout}
              title="تسجيل الخروج"
              data-testid="logout-btn"
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      <nav className="flex gap-1 overflow-x-auto border-t border-slate-100 px-4 py-2 lg:hidden">
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