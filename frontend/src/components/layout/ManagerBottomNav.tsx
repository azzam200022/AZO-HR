import { NavLink } from "react-router-dom";
import { cn } from "@/lib/utils";
import { MANAGER_BOTTOM_NAV } from "@/components/layout/manager-navigation";

export default function ManagerBottomNav() {
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-50 border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_16px_-6px_rgba(15,23,42,0.18)] backdrop-blur-md"
      aria-label="التنقل الرئيسي للإدارة"
      data-testid="manager-bottom-nav"
    >
      <div className="mx-auto grid max-w-3xl grid-cols-5 items-end px-2 pt-2.5 pb-2 sm:px-5 sm:pt-3">
        {MANAGER_BOTTOM_NAV.map(({ to, label, icon: Icon }) => {
          const isDashboard = to === "/";
          return (
            <NavLink
              key={to}
              to={to}
              end={isDashboard}
              data-testid={`manager-bottom-${to === "/" ? "dashboard" : to.slice(1)}`}
              className={({ isActive }) =>
                cn(
                  "flex min-w-0 flex-col items-center justify-end gap-1 rounded-xl font-semibold transition-colors",
                  isActive ? "text-teal-700" : "text-slate-400 hover:text-slate-600",
                )
              }
            >
              {({ isActive }) => (
                <>
                  {isDashboard ? (
                    <span
                      className={cn(
                        "-mt-7 flex h-16 w-16 items-center justify-center rounded-full border-4 border-background shadow-lg transition-all duration-200",
                        isActive
                          ? "scale-105 bg-gradient-to-br from-teal-500 to-teal-700 text-white"
                          : "bg-slate-100 text-slate-500 hover:bg-slate-200",
                      )}
                    >
                      <Icon className="h-7 w-7" strokeWidth={1.8} />
                    </span>
                  ) : (
                    <Icon className={cn("h-5 w-5 transition-transform", isActive && "scale-110")} />
                  )}
                  <span
                    className={cn(
                      "max-w-full truncate text-[9px] sm:text-[11px]",
                      isDashboard && "mt-0.5 font-bold",
                    )}
                  >
                    {label}
                  </span>
                </>
              )}
            </NavLink>
          );
        })}
      </div>
    </nav>
  );
}
