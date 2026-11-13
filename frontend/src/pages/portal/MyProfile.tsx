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

/** Left tab: the employee's own profile + full monthly reports. */
export default function MyProfile() {
  const queryClient = useQueryClient();
  const reportQuery = useQuery({
    queryKey: ["me", "report", "cycle", "current"],
    queryFn: () => apiGet<EmployeeReport>("/me/report?cycle=current"),
  });
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
        description="سجل حضورك وإنجازاتك والحوافز والخصومات المسجّلة."
        testid="my-profile-title"
      />
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
        <EmployeeReportPanel
          report={reportQuery.data}
          isLoading={reportQuery.isLoading}
          adjustmentsPath="/me/adjustments"
          showAttendanceLog={false}
          showMonthPicker={false}
          reportLabel="تقرير حضور الدورة الحالية"
          testidPrefix="my-report"
        />
      </div>
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
