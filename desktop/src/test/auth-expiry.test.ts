import { describe, expect, it } from "vitest";
import { authNotice, isAuthExpired } from "../lib/authExpiry";
import type { AuthStatus } from "../lib/engine/types";

const connected: AuthStatus = {
  connected: true,
  emailMasked: "s***@gmail.com",
  capturedAt: 1_000,
  expiresAt: 2_000,
  keyringAvailable: true,
  error: null,
  errorHint: null,
};

describe("auth expiry", () => {
  it("treats a saved sign-in as valid until its expected expiry", () => {
    expect(isAuthExpired(connected, 1_999)).toBe(false);
    expect(isAuthExpired(connected, 2_000)).toBe(true);
    expect(isAuthExpired(null, 2_000)).toBe(false);
    expect(isAuthExpired({ ...connected, connected: false }, 2_000)).toBe(false);
  });

  it("shows an expired banner once the sign-in lapses", () => {
    expect(authNotice(connected, false, 1_999)).toBeNull();
    expect(authNotice(connected, false, 2_000)).toBe("expired");
    expect(authNotice(connected, true, 2_000)).toBe("expired");
  });

  it("distinguishes a stopped job from a renewed connection", () => {
    expect(authNotice(connected, true, 1_500)).toBe("reconnected");
    expect(authNotice({ ...connected, connected: false }, true, 1_500)).toBe(
      "needs_auth",
    );
  });
});
