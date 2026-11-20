import { describe, expect, it } from "vitest";
import { getAuthScreenState } from "./auth-screen-state";
import type { SessionInfo } from "./types";

const authenticatedSession: SessionInfo = {
  authenticated: true,
  role: "employee",
  email: "employee@example.com",
  name: "موظف",
  employee_id: "employee-1",
};

const unauthenticatedSession: SessionInfo = {
  authenticated: false,
  role: null,
  email: "",
  name: "",
  employee_id: "",
};

describe("getAuthScreenState", () => {
  it("keeps the splash screen while the first session check is pending", () => {
    expect(getAuthScreenState(true, false, undefined)).toBe("loading");
  });

  it("does not show the login form when the session check fails before returning data", () => {
    expect(getAuthScreenState(false, true, undefined)).toBe("unavailable");
  });

  it("shows the connection screen when React Query pauses offline", () => {
    expect(getAuthScreenState(false, true, undefined)).toBe("unavailable");
  });

  it("does not treat a failed check as proof that a known session is signed out", () => {
    expect(getAuthScreenState(false, true, authenticatedSession)).toBe("authenticated");
  });

  it("shows login only after the server confirms there is no active session", () => {
    expect(getAuthScreenState(false, false, unauthenticatedSession)).toBe("login");
  });

  it("shows unavailable when a signed-out response cannot be refreshed", () => {
    expect(getAuthScreenState(false, true, unauthenticatedSession)).toBe("unavailable");
  });
});
