import { describe, expect, it } from "vitest";
import { browserLocationErrorMessage } from "./browser-location";

describe("browser geolocation errors", () => {
  it("guides employees to browser settings when permission is denied", () => {
    expect(browserLocationErrorMessage(1)).toContain("إعدادات الموقع");
  });

  it("explains when the device cannot provide a location fix", () => {
    expect(browserLocationErrorMessage(2)).toContain("خدمات الموقع");
  });

  it("suggests retrying after a location timeout", () => {
    expect(browserLocationErrorMessage(3)).toContain("انتهت مهلة");
  });
});
