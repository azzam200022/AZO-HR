export type BrowserPushSetupIssue =
  | "unsupported"
  | "insecure-context"
  | "server-unreachable"
  | "server-unconfigured"
  | "service-worker-unavailable";

const messages: Record<BrowserPushSetupIssue, string> = {
  unsupported: "هذا المتصفح لا يدعم إشعارات الويب المطلوبة. جرّب أحدث إصدار من Chrome.",
  "insecure-context": "افتح الموقع عبر HTTPS لتفعيل إشعارات المتصفح.",
  "server-unreachable": "تعذر الوصول إلى إعدادات الإشعارات على الخادم. تحقق من الاتصال ثم أعد الفحص.",
  "server-unconfigured": "الخادم لا يرسل إعدادات إشعارات المتصفح. يلزم ضبطها على الخادم.",
  "service-worker-unavailable": "تعذر تسجيل خدمة الإشعارات لهذا الموقع. أعد تحميل الصفحة ثم حاول مجددًا.",
};

export function browserPushSetupMessage(issue: BrowserPushSetupIssue | null) {
  return issue
    ? messages[issue]
    : "إعداد إشعارات المتصفح غير جاهز. تأكد من الاتصال الآمن بالخادم ثم أعد الفحص.";
}
