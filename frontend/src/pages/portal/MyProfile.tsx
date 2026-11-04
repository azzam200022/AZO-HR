import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import { currentMonthStr } from "@/lib/format";
import type { EmployeeReport } from "@/lib/types";
import { FadeIn, PageHeader } from "@/components/shared";
import EmployeeReportPanel from "@/components/EmployeeReportPanel";

/** Left tab: the employee's own profile + full monthly reports. */
export default function MyProfile() {
  const [month, setMonth] = useState(currentMonthStr());
  const reportQuery = useQuery({
    queryKey: ["me", "report", month],
    queryFn: () => apiGet<EmployeeReport>(`/me/report?month=${month}`),
  });

  return (
    <FadeIn>
      <PageHeader
        title="ملفي الشخصي"
        description="سجل حضورك وإجازاتك والحوافز والخصومات المسجّلة."
        testid="my-profile-title"
      />
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
        <EmployeeReportPanel
          report={reportQuery.data}
          isLoading={reportQuery.isLoading}
          month={month}
          onMonthChange={setMonth}
          adjustmentsPath="/me/adjustments"
          testidPrefix="my-report"
        />
      </div>
    </FadeIn>
  );
}