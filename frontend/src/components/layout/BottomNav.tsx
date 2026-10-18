import { NavLink } from "react-router-dom";
import { CalendarDays, Fingerprint, UserRound } from "lucide-react";
import { cn } from "@/lib/utils";

// Employee bottom navigation (RTL): leaves on the right, the raised fingerprint punch
// button in the middle, the personal profile on the left.
const ITEMS = [
  { to: "/me/leaves", label: "الإجازات", icon: CalendarDays, testid: "bottom-nav-leaves" },
  { to: "/me/profile", label: "ملفي", icon: UserRound, testid: "bottom-nav-profile" },
];

export default function BottomNav() {
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-50 border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_16px_-6px_rgba(15,23,42,0.18)] backdrop-blur-md"
      data-testid="portal-bottom-nav"
    >
      <div className="mx-auto grid max-w-md grid-cols-3 items-end px-5 pt-2 pb-2.5">
        {/* right: leaves */}
        <NavLink
          to={ITEMS[0].to}
          data-testid={ITEMS[0].testid}
          className={({ isActive }) =>
            cn(
              "flex flex-col items-center gap-1 rounded-xl py-1.5 text-[11px] font-semibold transition-colors",
              isActive ? "text-teal-700" : "text-slate-400 hover:text-slate-600",
            )
          }
        >
          {({ isActive }) => (
            <>
              <CalendarDays className={cn("h-5 w-5 transition-transform", isActive && "scale-110")} />
              {ITEMS[0].label}
            </>
          )}
        </NavLink>

        {/* center: the punch screen — raised fingerprint */}
        <NavLink to="/me" end data-testid="bottom-nav-punch" className="flex flex-col items-center">
          {({ isActive }) => (
            <>
              <span
                className={cn(
                  "-mt-7 flex h-16 w-16 items-center justify-center rounded-full border-4 border-white shadow-lg transition-all duration-200",
                  isActive
                    ? "bg-gradient-to-br from-teal-500 to-teal-700 text-white scale-105"
                    : "bg-slate-100 text-slate-400 hover:bg-slate-200",
                )}
              >
                <Fingerprint className="h-8 w-8" strokeWidth={1.75} />
              </span>
              <span
                className={cn(
                  "mt-1 text-[11px] font-bold",
                  isActive ? "text-teal-700" : "text-slate-400",
                )}
              >
                البصمة
              </span>
            </>
          )}
        </NavLink>

        {/* left: profile */}
        <NavLink
          to={ITEMS[1].to}
          data-testid={ITEMS[1].testid}
          className={({ isActive }) =>
            cn(
              "flex flex-col items-center gap-1 rounded-xl py-1.5 text-[11px] font-semibold transition-colors",
              isActive ? "text-teal-700" : "text-slate-400 hover:text-slate-600",
            )
          }
        >
          {({ isActive }) => (
            <>
              <UserRound className={cn("h-5 w-5 transition-transform", isActive && "scale-110")} />
              {ITEMS[1].label}
            </>
          )}
        </NavLink>
      </div>
    </nav>
  );
}