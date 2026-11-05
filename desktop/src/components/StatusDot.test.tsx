import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatusDot } from "./StatusDot";

describe("StatusDot", () => {
  it("always renders a visible text label", () => {
    render(<StatusDot tone="good" label="Uploaded" />);
    expect(screen.getByText("Uploaded")).toBeTruthy();
  });

  it("hides the colored dot from assistive tech", () => {
    const { container } = render(<StatusDot tone="danger" label="Failed" />);
    const dot = container.querySelector("span[aria-hidden='true']");
    expect(dot).toBeTruthy();
  });
});
