import type { ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import Navbar from "@/components/layout/Navbar";
import BottomNav from "@/components/layout/BottomNav";
import Dashboard from "@/pages/Dashboard";
import Employees from "@/pages/Employees";
import Attendance from "@/pages/Attendance";
import Leaves from "@/pages/Leaves";
import Payroll from "@/pages/Payroll";
import Locations from "@/pages/Locations";
import MyAttendance from "@/pages/portal/MyAttendance";
import MyLeaves from "@/pages/portal/MyLeaves";
import MyProfile from "@/pages/portal/MyProfile";
import Login from "@/pages/Login";
import { AuthProvider, useAuth } from "@/lib/auth";

function Splash() {
  return (
    <div className="flex min-h-svh items-center justify-center bg-slate-50">
      <div className="h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-teal-600" />
    </div>
  );
}

// The server is the real gate (every manager route sits behind require_manager); these
// guards only keep the UI honest about what the session may reach.
function ManagerOnly({ children }: { children: ReactNode }) {
  const { role } = useAuth();
  if (role !== "manager") return <Navigate to="/me" replace />;
  return <>{children}</>;
}

// The portal is employee-only: a manager landing on /me (e.g. the URL left over from a
// previous session on this browser) belongs on the dashboard, not on an empty portal.
function EmployeeOnly({ children }: { children: ReactNode }) {
  const { role } = useAuth();
  if (role !== "employee") return <Navigate to="/" replace />;
  return <>{children}</>;
}

function Shell() {
  const { session, isLoading, role } = useAuth();

  if (isLoading) return <Splash />;
  if (!session?.authenticated) return <Login />;

  const isEmployee = role === "employee";

  return (
    <div className="min-h-svh bg-background text-foreground">
      <Navbar />
      <main
        className={
          isEmployee
            ? "mx-auto w-full max-w-2xl px-4 pt-6 pb-32 md:px-6"
            : "mx-auto w-full max-w-7xl px-4 pt-6 pb-12 md:px-8"
        }
      >
        <Routes>
          <Route path="/" element={role === "manager" ? <Dashboard /> : <Navigate to="/me" replace />} />
          <Route
            path="/employees"
            element={
              <ManagerOnly>
                <Employees />
              </ManagerOnly>
            }
          />
          <Route
            path="/attendance"
            element={
              <ManagerOnly>
                <Attendance />
              </ManagerOnly>
            }
          />
          <Route
            path="/leaves"
            element={
              <ManagerOnly>
                <Leaves />
              </ManagerOnly>
            }
          />
          <Route
            path="/payroll"
            element={
              <ManagerOnly>
                <Payroll />
              </ManagerOnly>
            }
          />
          <Route
            path="/locations"
            element={
              <ManagerOnly>
                <Locations />
              </ManagerOnly>
            }
          />
          {/* Employee portal tabs — driven by the bottom navigation bar */}
          <Route
            path="/me"
            element={
              <EmployeeOnly>
                <MyAttendance />
              </EmployeeOnly>
            }
          />
          <Route
            path="/me/leaves"
            element={
              <EmployeeOnly>
                <MyLeaves />
              </EmployeeOnly>
            }
          />
          <Route
            path="/me/profile"
            element={
              <EmployeeOnly>
                <MyProfile />
              </EmployeeOnly>
            }
          />
          <Route path="*" element={<Navigate to={role === "manager" ? "/" : "/me"} replace />} />
        </Routes>
      </main>
      {isEmployee && <BottomNav />}
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Shell />
      <Toaster />
    </AuthProvider>
  );
}
