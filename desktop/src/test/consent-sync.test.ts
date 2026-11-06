import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import consent from "../content/consent.json";

describe("consent text", () => {
  it("matches the canonical copy in docs/05", () => {
    const docsPath = resolve(
      process.cwd(),
      "../docs/05-security-privacy-legal.md",
    );
    const docs = readFileSync(docsPath, "utf8");
    const match = docs.match(
      /<!-- consent-json:start -->\s*```json\s*([\s\S]*?)```\s*<!-- consent-json:end -->/,
    );
    expect(match).toBeTruthy();
    const documented = JSON.parse(match![1]);
    expect(documented).toEqual(consent);
  });
});
