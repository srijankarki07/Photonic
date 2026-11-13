import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Activity } from "./Activity";
import type { JobsState } from "../lib/engine/useJobs";

function jobsState(overrides: Partial<JobsState> = {}): JobsState {
  return {
    job: null,
    selectedJob: null,
    history: [],
    recovered: [],
    error: null,
    starting: false,
    authRequired: false,
    start: vi.fn(async () => null),
    cancel: vi.fn(async () => undefined),
    retryFailed: vi.fn(async () => undefined),
    resume: vi.fn(async () => undefined),
    loadHistory: vi.fn(async () => undefined),
    openJob: vi.fn(async () => undefined),
    closeJob: vi.fn(),
    refresh: vi.fn(async () => undefined),
    clear: vi.fn(),
    ...overrides,
  };
}

describe("Activity", () => {
  it("shows the two tabs and empty states", () => {
    render(
      <Activity
        jobs={jobsState()}
        onOpenJob={vi.fn()}
        onCloseJob={vi.fn()}
        onCancel={vi.fn()}
        onRetry={vi.fn()}
        onResume={vi.fn()}
        onReconnect={vi.fn()}
        onChooseFolder={vi.fn()}
      />,
    );
    expect(screen.getByRole("tab", { name: /in progress/i })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /past/i })).toBeTruthy();
    expect(screen.getByText("No backup running")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: /past/i }));
    expect(screen.getByText("Nothing here yet")).toBeTruthy();
  });
});
