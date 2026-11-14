import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiGet, apiPost } from "@/lib/api";
import {
  requestBackgroundLocationPermissions,
  stopBackgroundLocationTracking,
  supportsBackgroundLocation,
} from "@/lib/background-location";
import { errorText } from "@/lib/format";
import type { EmployeeReport, TrackingConsent } from "@/lib/types";
import { Checkbox } from "@/components/ui/checkbox";
import { FadeIn, PageHeader } from "@/components/shared";
import EmployeeReportPanel from "@/components/EmployeeReportPanel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type CycleSelection = "current" | "previous";

/** The employee's own profile and cycle-by-cycle reports. */
export default function MyProfile() {
  const queryClient = useQueryClient();
  const [selectedCycle, setSelectedCycle] = useState<CycleSelection>("current");
  const currentReportQuery = useQuery({
    queryKey: ["me", "report", "cycle", "current"],
    queryFn: () => apiGet<EmployeeReport>("/me/report?cycle=current"),
  });
  const previousReportQuery = useQuery({
    queryKey: ["me", "report", "cycle", "previous"],
    queryFn: () => apiGet<EmployeeReport>("/me/report?cycle=previous"),
  });
  const currentAttendance = currentReportQuery.data?.attendance;
  const previousAttendance = previousReportQuery.data?.attendance;
  const hasPreviousCycle = Boolean(
    currentAttendance &&
      previousAttendance &&
      previousAttendance.cycle_start !== currentAttendance.cycle_start &&
      previousAttendance.cycle_end >= (currentReportQuery.data?.employee.hire_date ?? ""),
  );
  const activeCycle =
    selectedCycle === "previous" && hasPreviousCycle ? "previous" : "current";
  const cycleReports = [
    {
      value: "current" as const,
      label: "الدورة الحالية",
      query: currentReportQuery,
    },
    {
      value: "previous" as const,
      label: "الدورة السابقة",
      query: previousReportQuery,
    },
  ];
  const trackingConsentQuery = useQuery({
    queryKey: ["me", "tracking-consent"],
    queryFn: () => apiGet<TrackingConsent>("/me/tracking-consent"),
  });
  const trackingConsentMutation = useMutation({
    mutationFn: async (enabled: boolean) => {
      if (enabled && supportsBackgroundLocation()) {
        await requestBackgroundLocationPermissions();
      }
      const saved = await apiPost<TrackingConsent>("/me/tracking-consent", { enabled });
      if (!enabled) await stopBackgroundLocationTracking(false);
      return saved;
    },
    onSuccess: (consent) => {
      queryClient.setQueryData(["me", "tracking-consent"], consent);
    },
    onError: (error) => toast.error(errorText(error)),
  });

  return (
    <FadeIn>
      <PageHeader
        title="ملفي الشخصي"
        description="اختر الدورة لعرض حضورك والحوافز والخصومات المسجّلة خلالها."
        testid="my-profile-title"
      />
      <Tabs
        value={activeCycle}
        onValueChange={(value) => setSelectedCycle(value as CycleSelection)}
        className="mt-4"
      >
        <TabsList className="grid w-full grid-cols-2" data-testid="my-profile-cycle-tabs">
          <TabsTrigger value="current" data-testid="my-profile-current-cycle">
            الدورة الحالية
          </TabsTrigger>
          <TabsTrigger
            value="previous"
            disabled={!hasPreviousCycle}
            data-testid="my-profile-previous-cycle"
          >
            الدورة السابقة
          </TabsTrigger>
        </TabsList>
        {previousReportQuery.isError ? (
          <p className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700">
            تعذّر تحميل تقرير الدورة السابقة.
          </p>
        ) : (
          !previousReportQuery.isLoading &&
          currentAttendance &&
          previousAttendance &&
          !hasPreviousCycle && (
            <p className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500">
              لا توجد دورة سابقة ضمن فترة عملك بعد.
            </p>
          )
        )}
        {cycleReports.map(({ value, label, query }) => (
          <TabsContent key={value} value={value} className="mt-3">
            {value === "previous" && !hasPreviousCycle ? (
              null
            ) : (
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
                <EmployeeReportPanel
                  report={query.data}
                  isLoading={query.isLoading}
                  adjustmentsPath={`/me/adjustments?cycle=${value}`}
                  showAttendanceLog={false}
                  showMonthPicker={false}
                  showLeaveBalance={value === "current"}
                  reportLabel={`تقرير حضور ${label}`}
                  testidPrefix={`my-report-${value}`}
                />
              </div>
            )}
          </TabsContent>
        ))}
      </Tabs>
      <div
        className="mt-4 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-xs"
        data-testid="tracking-consent-card"
      >
        <div className="flex items-center justify-between gap-3">
          <label
            htmlFor="tracking-consent-checkbox"
            className="cursor-pointer text-sm font-semibold text-slate-800"
          >
            تتبع الموقع أثناء الدوام
          </label>
          <Checkbox
            id="tracking-consent-checkbox"
            checked={trackingConsentQuery.data?.enabled ?? false}
            onCheckedChange={(checked) => trackingConsentMutation.mutate(checked === true)}
            disabled={trackingConsentQuery.isLoading || trackingConsentMutation.isPending}
            data-testid="tracking-consent-checkbox"
            aria-label="تتبع الموقع أثناء الدوام"
          />
        </div>
        <p
          className="mt-2 text-xs leading-6 text-slate-500"
          data-testid="tracking-platform-hint"
        >
          {supportsBackgroundLocation()
            ? "في تطبيق الهاتف، يعمل التتبع بالخلفية أثناء الدوام بعد موافقتك ومنح أذونات النظام. قد يوقفه إغلاق التطبيق قسراً أو إيقافه من إعدادات الجهاز."
            : "في المتصفح، يطلب مواردي إذن الموقع عند تسجيل الحضور. إذا رفضته سابقاً، فعّله من إعدادات الموقع في المتصفح. يعمل التتبع فقط عندما تكون صفحة مواردي مفتوحة ومرئية، ويتوقف عند إخفائها أو إغلاق المتصفح. للتتبع بالخلفية استخدم تطبيق الهاتف."}
        </p>
      </div>
    </FadeIn>
  );
}
