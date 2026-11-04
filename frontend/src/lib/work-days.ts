export const WORK_DAYS = [
  { value: 5, label: "السبت" },
  { value: 6, label: "الأحد" },
  { value: 0, label: "الاثنين" },
  { value: 1, label: "الثلاثاء" },
  { value: 2, label: "الأربعاء" },
  { value: 3, label: "الخميس" },
  { value: 4, label: "الجمعة" },
] as const;

// Preserve the app's previous behavior for existing employees: every weekday is scheduled.
export const DEFAULT_WORK_DAYS = [0, 1, 2, 3, 4, 5, 6];

export function workDaysLabel(days?: number[] | null): string {
  const selected = new Set(days ?? DEFAULT_WORK_DAYS);
  if (selected.size === 7 && WORK_DAYS.every((day) => selected.has(day.value))) {
    return "كل أيام الأسبوع";
  }
  if (selected.size === 0) return "لم تُحدد";
  return WORK_DAYS.filter((day) => selected.has(day.value))
    .map((day) => day.label)
    .join("، ");
}
