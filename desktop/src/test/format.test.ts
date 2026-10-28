import { describe, expect, it } from "vitest";
import { formatSpeed } from "../lib/format";

describe("formatSpeed", () => {
  it("formats bytes per second", () => {
    expect(formatSpeed(1024 * 1024)).toBe("1.00 MB/s");
    expect(formatSpeed(8_400_000)).toBe("8.01 MB/s");
  });

  it("hides missing or idle rates", () => {
    expect(formatSpeed(0)).toBe("-");
    expect(formatSpeed(undefined)).toBe("-");
    expect(formatSpeed(Number.NaN)).toBe("-");
  });
});
