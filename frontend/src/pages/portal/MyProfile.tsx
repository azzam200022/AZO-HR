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
import {
  getIconClickSoundEnabled,
  saveIconClickSoundEnabled,
} from "@/lib/icon-click-sound";
import type { EmployeeReport, TrackingConsent } from "@/lib/types";
import { Checkbox } from "@/components/ui/checkbox";
import { FadeIn, PageHeader } from "@/components/shared";
import EmployeeReportPanel from "@/components/EmployeeReportPanel";
import DeleteAccountCard from "@/components/DeleteAccountCard";
import { LocationDisclosureDialog } from "@/components/LocationDisclosureDialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type CycleSelection = "current" | "previous";

function CycleSelector({
  label,
  value,
  onChange,
  hasPreviousCycle,
  testidPrefix,
}: {
  label: string;
  value: CycleSelection;
  onChange: (value: CycleSelection) => void;
  hasPreviousCycle: boolean;
  testidPrefix: string;
}) {
  return (
    <Tabs
      value={value}
      onValueChange={(next) => onChange(next as CycleSelection)}
      className="w-full"
    >
      <TabsList
        className="grid w-full grid-cols-2"
        aria-label={label}
        data-testid={`${testidPrefix}-cycle-tabs`}
      >
        <TabsTrigger value="current" data-testid={`${testidPrefix}-current-cycle`}>
          الدورة الحالية
        </TabsTrigger>
        <TabsTrigger
          value="previous"
          disabled={!hasPreviousCycle}
          data-testid={`${testidPrefix}-previous-cycle`}
        >
          الدورة السابقة
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );
}

/** The employee's own profile and cycle-by-cycle reports. */
export default function MyProfile() {
  const queryClient = useQueryClient();
  const [selectedAdjustmentsCycle, setSelectedAdjustmentsCycle] = useState<CycleSelection>("current");
  const [selectedAttendanceCycle, setSelectedAttendanceCycle] = useState<CycleSelection>("current");
  const [appSoundMuted, setAppSoundMuted] = useState(() => !getIconClickSoundEnabled());
  const [disclosureOpen, setDisclosureOpen] = useState(false);
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
  const activeAdjustmentsCycle =
    selectedAdjustmentsCycle === "previous" && hasPreviousCycle ? "previous" : "current";
  const activeAttendanceCycle =
    selectedAttendanceCycle === "previous" && hasPreviousCycle ? "previous" : "current";
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
        testid="my-profile-title"
      />
      <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
        <EmployeeReportPanel
          report={currentReportQuery.data}
          attendanceReport={
            activeAttendanceCycle === "previous"
              ? previousReportQuery.data?.attendance
              : undefined
          }
          isLoading={currentReportQuery.isLoading}
          adjustmentsPath={`/me/adjustments?cycle=${activeAdjustmentsCycle}`}
          showIdentity={false}
          showAttendanceLog={false}
          showMonthPicker={false}
          showLeaveBalance={false}
          reportLabel={`تقرير حضور الدورة ${activeAttendanceCycle === "current" ? "الحالية" : "السابقة"}`}
          adjustmentsCycleSelector={
            <CycleSelector
              label="دورة الحوافز والخصومات"
              value={activeAdjustmentsCycle}
              onChange={setSelectedAdjustmentsCycle}
              hasPreviousCycle={hasPreviousCycle}
              testidPrefix="my-profile-adjustments"
            />
          }
          attendanceCycleSelector={
            <CycleSelector
              label="دورة الحضور"
              value={activeAttendanceCycle}
              onChange={setSelectedAttendanceCycle}
              hasPreviousCycle={hasPreviousCycle}
              testidPrefix="my-profile-attendance"
            />
          }
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
            onCheckedChange={(checked) =>
              checked === true ? setDisclosureOpen(true) : trackingConsentMutation.mutate(false)
            }
            disabled={trackingConsentQuery.isLoading || trackingConsentMutation.isPending}
            data-testid="tracking-consent-checkbox"
            aria-label="تتبع الموقع أثناء الدوام"
          />
        </div>
        <div className="mt-3 flex items-center justify-between gap-3 border-t border-slate-100 pt-3">
          <label
            htmlFor="app-sound-mute-checkbox"
            className="cursor-pointer text-sm font-semibold text-slate-800"
          >
            كتم صوت التطبيق
          </label>
          <Checkbox
            id="app-sound-mute-checkbox"
            checked={appSoundMuted}
            onCheckedChange={(checked) => {
              const muted = checked === true;
              saveIconClickSoundEnabled(!muted);
              setAppSoundMuted(muted);
            }}
            data-testid="app-sound-mute-checkbox"
            aria-label="كتم صوت التطبيق"
          />
        </div>
      </div>
      <DeleteAccountCard />
      <LocationDisclosureDialog
        open={disclosureOpen}
        onAccept={() => {
          setDisclosureOpen(false);
          trackingConsentMutation.mutate(true);
        }}
        onDecline={() => setDisclosureOpen(false)}
      />
    </FadeIn>
  );
}
