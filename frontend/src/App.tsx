import type { ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import Navbar from "@/components/layout/Navbar";
import Dashboard from "@/pages/Dashboard";
import Employees from "@/pages/Employees";
import Attendance from "@/pages/Attendance";
import Leaves from "@/pages/Leaves";
import Payroll from "@/pages/Payroll";
import Locations from "@/pages/Locations";
import MyPortal from "@/pages/MyPortal";
import { RoleProvider, useRole } from "@/lib/role";

// No login in this app — the role switcher in the navbar decides which workspace renders.
function ManagerRoute({ children }: { children: ReactNode }) {
  const { role } = useRole();
  if (role !== "manager") return <Navigate to="/me" replace />;
  return <>{children}</>;
}

function RootRoute() {
  const { role } = useRole();
  return role === "manager" ? <Dashboard /> : <MyPortal />;
}

export default function App() {
  return (
    <RoleProvider>
      <div className="min-h-svh bg-background text-foreground">
        <Navbar />
        <main className="mx-auto w-full max-w-7xl px-4 pt-6 pb-12 md:px-8">
          <Routes>
            <Route path="/" element={<RootRoute />} />
            <Route
              path="/employees"
              element={
                <ManagerRoute>
                  <Employees />
                </ManagerRoute>
              }
            />
            <Route
              path="/attendance"
              element={
                <ManagerRoute>
                  <Attendance />
                </ManagerRoute>
              }
            />
            <Route
              path="/leaves"
              element={
                <ManagerRoute>
                  <Leaves />
                </ManagerRoute>
              }
            />
            <Route
              path="/payroll"
              element={
                <ManagerRoute>
                  <Payroll />
                </ManagerRoute>
              }
            />
            <Route
              path="/locations"
              element={
                <ManagerRoute>
                  <Locations />
                </ManagerRoute>
              }
            />
            <Route path="/me" element={<MyPortal />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
      <Toaster />
    </RoleProvider>
  );
}