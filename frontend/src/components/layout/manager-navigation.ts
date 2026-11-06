import {
  CalendarDays,
  Clock,
  Gauge,
  LayoutDashboard,
  MapPin,
  MessageSquare,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";

export interface ManagerNavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  testid: string;
}

export const MANAGER_NAV: ManagerNavItem[] = [
  { to: "/", label: "لوحة التحكم", icon: LayoutDashboard, testid: "nav-dashboard" },
  { to: "/employees", label: "الموظفون", icon: Users, testid: "nav-employees" },
  { to: "/attendance", label: "الحضور", icon: Clock, testid: "nav-attendance" },
  { to: "/leaves", label: "الإجازات", icon: CalendarDays, testid: "nav-leaves" },
  { to: "/payroll", label: "الرواتب", icon: Wallet, testid: "nav-payroll" },
  { to: "/discipline", label: "الانضباط", icon: Gauge, testid: "nav-discipline" },
  { to: "/messages", label: "الرسائل", icon: MessageSquare, testid: "nav-messages" },
  { to: "/locations", label: "المواقع", icon: MapPin, testid: "nav-locations" },
];

// RTL order: attendance and leaves on the right; discipline and messages on the left.
export const MANAGER_BOTTOM_NAV: ManagerNavItem[] = [
  MANAGER_NAV[2],
  MANAGER_NAV[3],
  MANAGER_NAV[0],
  MANAGER_NAV[5],
  MANAGER_NAV[6],
];
