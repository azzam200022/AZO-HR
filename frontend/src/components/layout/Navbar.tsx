import { useEffect, useRef, useState } from "react";
import { useIsFetching, useQueryClient } from "@tanstack/react-query";
import { Link, NavLink } from "react-router-dom";
import { format } from "date-fns";
import { arSA } from "date-fns/locale";
import {
  LogOut,
  Menu,
  MessageSquare,
  RefreshCw,
  Users,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import NotificationBell from "@/components/layout/NotificationBell";
import EmployeeLocationStatus from "@/components/layout/EmployeeLocationStatus";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { MANAGER_NAV } from "@/components/layout/manager-navigation";

export default function Navbar() {
  const { session, role, logout } = useAuth();
  const queryClient = useQueryClient();
  const isRefreshing = useIsFetching() > 0;
  const [now, setNow] = useState(() => new Date());
  const [drawerOpen, setDrawerOpen] = useState(false);
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (role !== "manager") return;

    const onTouchStart = (event: TouchEvent) => {
      const touch = event.changedTouches[0];
      if (touch) touchStart.current = { x: touch.clientX, y: touch.clientY };
    };
    const onTouchEnd = (event: TouchEvent) => {
      const start = touchStart.current;
      const touch = event.changedTouches[0];
      touchStart.current = null;
      if (!start || !touch) return;

      const deltaX = touch.clientX - start.x;
      const deltaY = touch.clientY - start.y;
      if (Math.abs(deltaX) < 70 || Math.abs(deltaX) < Math.abs(deltaY) * 1.25) return;
      if (drawerOpen && deltaX > 70) {
        setDrawerOpen(false);
      } else if (!drawerOpen && start.x >= window.innerWidth - 28 && deltaX < -70) {
        setDrawerOpen(true);
      }
    };

    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchend", onTouchEnd, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchend", onTouchEnd);
    };
  }, [drawerOpen, role]);

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/85 shadow-xs backdrop-blur-md">
      <div className="mx-auto flex min-w-0 max-w-7xl items-center gap-2 px-2.5 py-2.5 sm:gap-3 sm:px-4 sm:py-3 md:gap-6 md:px-8 max-[360px]:gap-1 max-[360px]:px-2">
        <Link to={role === "manager" ? "/" : "/me"} data-testid="brand-link" className="flex shrink-0 items-center gap-2.5">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-teal-500 to-teal-700 text-white shadow-sm">
            <Users className="h-5 w-5" />
          </span>
          <span className="min-w-0 leading-tight">
            <span className="block text-base font-extrabold tracking-tight text-slate-900">مواردي</span>
            <span className="block text-[11px] font-medium text-slate-500 max-[500px]:hidden">إدارة الموارد البشرية</span>
          </span>
        </Link>

        {role === "manager" && (
          <Button
            type="button"
            size="icon"
            variant="outline"
            onClick={() => setDrawerOpen(true)}
            aria-label="فتح قائمة التنقل"
            aria-expanded={drawerOpen}
            data-testid="manager-menu-btn"
            className="h-10 w-10 shrink-0 rounded-xl border-slate-200 text-slate-700 hover:border-teal-200 hover:bg-teal-50 hover:text-teal-700"
          >
            <Menu className="h-5 w-5" />
          </Button>
        )}

        <div className="ms-auto flex min-w-0 items-center gap-1.5 sm:gap-3 max-[360px]:gap-1">
          <span className="hidden text-xs font-medium text-slate-500 xl:block" data-testid="header-date">
            {format(now, "EEEE، d MMMM yyyy", { locale: arSA })}
          </span>
          {role === "employee" && (
            <NavLink
              to="/me/messages"
              title="الرسائل"
              className={({ isActive }) =>
                cn(
                  "flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors",
                  isActive ? "bg-teal-50 text-teal-700" : "text-slate-600 hover:bg-slate-100",
                )
              }
              data-testid="employee-messages-link"
            >
              <MessageSquare className="h-4.5 w-4.5" />
            </NavLink>
          )}
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            onClick={() => void queryClient.invalidateQueries({ refetchType: "active" })}
            disabled={isRefreshing}
            aria-label={isRefreshing ? "جارٍ تحديث البيانات" : "تحديث البيانات"}
            title={isRefreshing ? "جارٍ تحديث البيانات" : "تحديث البيانات"}
            data-testid="refresh-data-btn"
            className="shrink-0"
          >
            <RefreshCw className={cn("h-4 w-4", isRefreshing && "animate-spin")} />
          </Button>
          <NotificationBell audience={role === "manager" ? "manager" : "employee"} />
          <div className="flex min-w-0 shrink-0 items-center gap-1 rounded-full bg-slate-100 py-1 ps-1.5 pe-1 sm:gap-2 sm:ps-3">
            <span
              className="min-w-0 max-w-24 truncate text-xs font-semibold text-slate-700 max-[500px]:max-w-14 max-[380px]:max-w-10"
              data-testid="current-user-label"
              title={session?.name || session?.email || "—"}
            >
              {session?.name || session?.email || "—"}
              <span className="ms-1.5 text-[10px] font-medium text-slate-500 max-[500px]:hidden">
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

      {role === "manager" && (
        <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
          <SheetContent
            side="right"
            showCloseButton
            className="w-[min(22rem,88vw)] border-slate-200 bg-white p-0"
            data-testid="manager-navigation-drawer"
          >
            <SheetHeader className="border-b border-slate-100 px-5 pb-5 pt-10">
              <SheetTitle className="text-lg font-extrabold text-slate-900">قائمة التنقل</SheetTitle>
              <SheetDescription>جميع أقسام لوحة الإدارة في مكان واحد.</SheetDescription>
            </SheetHeader>
            <nav className="flex-1 space-y-1 overflow-y-auto p-3" aria-label="أقسام الإدارة">
              {MANAGER_NAV.map(({ to, label, icon: Icon, testid }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={to === "/"}
                  data-testid={testid}
                  onClick={() => setDrawerOpen(false)}
                  className={({ isActive }) =>
                    cn(
                      "flex items-center gap-3 rounded-xl px-3.5 py-3 text-sm font-semibold transition-colors",
                      isActive
                        ? "bg-teal-50 text-teal-800"
                        : "text-slate-600 hover:bg-slate-50 hover:text-slate-900",
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      <span
                        className={cn(
                          "flex h-9 w-9 items-center justify-center rounded-lg",
                          isActive ? "bg-teal-100 text-teal-700" : "bg-slate-100 text-slate-500",
                        )}
                      >
                        <Icon className="h-4 w-4" />
                      </span>
                      {label}
                    </>
                  )}
                </NavLink>
              ))}
              <EmployeeLocationStatus open={drawerOpen} />
            </nav>
            <div className="border-t border-slate-100 px-5 py-4 text-[11px] text-slate-400">
              اسحب من حافة الشاشة اليمنى لفتح القائمة، واسحب يميناً لإغلاقها.
            </div>
          </SheetContent>
        </Sheet>
      )}
    </header>
  );
}