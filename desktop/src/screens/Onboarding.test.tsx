import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Onboarding } from "./Onboarding";

function props(overrides: Partial<Parameters<typeof Onboarding>[0]> = {}) {
  return {
    step: "consent" as const,
    connected: false,
    emailMasked: null,
    keyringError: null,
    onAccept: vi.fn(),
    onConnect: vi.fn(),
    onChooseFolder: vi.fn(),
    onChooseFiles: vi.fn(),
    onSkip: vi.fn(),
    onTransparency: vi.fn(),
    ...overrides,
  };
}

describe("Onboarding consent", () => {
  it("keeps Continue disabled until the risk is acknowledged", () => {
    const handlers = props();
    render(<Onboarding {...handlers} />);
    const button = screen.getByRole("button", { name: /continue/i });
    expect(button).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox"));
    expect(button).not.toBeDisabled();
    fireEvent.click(button);
    expect(handlers.onAccept).toHaveBeenCalledOnce();
  });

  it("links to transparency", () => {
    const handlers = props();
    render(<Onboarding {...handlers} />);
    fireEvent.click(
      screen.getAllByRole("button", { name: /how photonic works/i })[0],
    );
    expect(handlers.onTransparency).toHaveBeenCalled();
  });
});

describe("Onboarding setup", () => {
  it("offers connect and choose actions without a sidebar", () => {
    const handlers = props({ step: "setup" });
    render(<Onboarding {...handlers} />);
    fireEvent.click(screen.getByRole("button", { name: /connect your phone/i }));
    expect(handlers.onConnect).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /choose folders/i }));
    expect(handlers.onChooseFolder).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /do this later/i }));
    expect(handlers.onSkip).toHaveBeenCalled();
  });
});
