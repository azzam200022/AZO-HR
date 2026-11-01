// Formatters shared across the HR app. Numbers use Latin digits with Arabic grouping.
const numberFmt = new Intl.NumberFormat("ar-SA-u-nu-latn", { maximumFractionDigits: 0 });

export const formatNumber = (value: number) => numberFmt.format(value);

/** Iraqi dinar — the app's currency. */
export const formatIQD = (value: number) => `${numberFmt.format(Math.round(value))} د.ع`;

export const CURRENCY_LABEL = "د.ع";

const AR_MONTHS = [
  "يناير",
  "فبراير",
  "مارس",
  "أبريل",
  "مايو",
  "يونيو",
  "يوليو",
  "أغسطس",
  "سبتمبر",
  "أكتوبر",
  "نوفمبر",
  "ديسمبر",
];

export const monthLabel = (month: string) =>
  `${AR_MONTHS[Number(month.slice(5, 7)) - 1] ?? ""} ${month.slice(0, 4)}`;

export const fmtDate = (iso: string) =>
  `${Number(iso.slice(8, 10))}/${Number(iso.slice(5, 7))}/${iso.slice(0, 4)}`;

export const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
};

export const currentMonthStr = () => todayStr().slice(0, 7);

export const durationLabel = (checkIn: string, checkOut: string) => {
  if (!checkIn || !checkOut) return "—";
  const [inH, inM] = checkIn.split(":").map(Number);
  const [outH, outM] = checkOut.split(":").map(Number);
  let minutes = outH * 60 + outM - (inH * 60 + inM);
  if (minutes < 0) minutes += 24 * 60; // night shift crossing midnight
  return `${Math.floor(minutes / 60)}س ${minutes % 60}د`;
};

/** Minutes of lateness formatted for Arabic UI ("صفر" when on time). */
export const lateLabel = (minutes: number) => {
  if (minutes <= 0) return "صفر";
  if (minutes < 60) return `${minutes} دقيقة`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}س` : `${h}س ${m}د`;
};

export const shiftLabel = (start: string, end: string) => `${start} ← ${end}`;

export function errorText(error: unknown): string {
  if (error && typeof error === "object" && "body" in error) {
    const body = (error as { body?: { detail?: unknown } }).body;
    if (typeof body?.detail === "string") return body.detail;
    if (Array.isArray(body?.detail) && body.detail.length > 0) {
      const first = body.detail[0] as { msg?: string };
      if (first?.msg) return "تحقق من صحة البيانات المدخلة";
    }
  }
  if (error instanceof Error) return error.message;
  return "حدث خطأ غير متوقع";
}