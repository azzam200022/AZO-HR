export type BrowserPushSetupIssue =
  | "unsupported"
  | "insecure-context"
  | "server-unreachable"
  | "server-unconfigured"
  | "service-worker-unavailable"
  | "subscription-failed";

const messages: Record<BrowserPushSetupIssue, string> = {
  unsupported: "هذا المتصفح لا يدعم إشعارات الويب المطلوبة. جرّب أحدث إصدار من Chrome.",
  "insecure-context": "افتح الموقع عبر HTTPS لتفعيل إشعارات المتصفح.",
  "server-unreachable": "تعذر الوصول إلى إعدادات الإشعارات على الخادم. تحقق من الاتصال ثم أعد الفحص.",
  "server-unconfigured": "مفتاح إشعارات المتصفح على الخادم غير صالح أو غير متطابق. يلزم تحديث مفاتيح VAPID.",
  "service-worker-unavailable": "تعذر تسجيل خدمة الإشعارات لهذا الموقع. أعد تحميل الصفحة ثم حاول مجددًا.",
  "subscription-failed": "تعذر إنشاء اشتراك الإشعارات في المتصفح. أعد الفحص وحاول مجددًا.",
};

export function browserPushSetupMessage(issue: BrowserPushSetupIssue | null) {
  return issue
    ? messages[issue]
    : "إعداد إشعارات المتصفح غير جاهز. تأكد من الاتصال الآمن بالخادم ثم أعد الفحص.";
}
