import { describe, expect, it } from "vitest";
import { humanizeError, skipReason } from "./messages";

describe("messages", () => {
  it("maps known errors to plain titles", () => {
    expect(
      humanizeError({ code: "auth_expired", message: "401", recoverable: false })
        .title,
    ).toBe("Your connection expired");
    expect(
      humanizeError({ code: "network", message: "reset", recoverable: true })
        .title,
    ).toBe("The connection was interrupted");
  });

  it("falls back without leaking a raw code", () => {
    const message = humanizeError({
      code: "weird_internal_code",
      message: "Something happened.",
      recoverable: false,
    });
    expect(message.title).toBe("Something went wrong");
    expect(message.body).toBe("Something happened.");
  });

  it("humanizes every UI skip reason without underscores", () => {
    const reasons = [
      "unsupported",
      "empty",
      "mime_mismatch",
      "unsupported_mime",
      "file_unstable",
      "already_uploaded",
      "ledger_uncertain",
      "symlink_skipped",
      "permission_denied",
      "selection_missing",
      "duplicate_selection",
      "not_a_file",
      "file_missing",
      "file_unreadable",
    ];
    for (const reason of reasons) {
      const label = skipReason(reason);
      expect(label.length).toBeGreaterThan(2);
      expect(label).not.toContain("_");
    }
  });
});
