import { describe, expect, it } from "vitest";
import {
  browserPushSetupMessage,
  type BrowserPushSetupIssue,
} from "./browser-push-status";

describe("browserPushSetupMessage", () => {
  it.each([
    ["unsupported", "هذا المتصفح لا يدعم إشعارات الويب المطلوبة."],
    ["insecure-context", "افتح الموقع عبر HTTPS"],
    ["server-unreachable", "تعذر الوصول إلى إعدادات الإشعارات"],
    ["server-unconfigured", "الخادم لا يرسل إعدادات إشعارات المتصفح"],
    ["service-worker-unavailable", "تعذر تسجيل خدمة الإشعارات"],
  ] as const satisfies ReadonlyArray<[BrowserPushSetupIssue, string]>)(
    "explains the %s setup failure",
    (issue, expectedMessage) => {
      expect(browserPushSetupMessage(issue)).toContain(expectedMessage);
    },
  );

  it("keeps a fallback message when the failure is unknown", () => {
    expect(browserPushSetupMessage(null)).toContain(
      "إعداد إشعارات المتصفح غير جاهز",
    );
  });
});
