import { describe, expect, it, vi } from "vitest";

const { listeners } = vi.hoisted(() => ({
  listeners: new Map<
    string,
    (event: { payload: unknown }) => void
  >(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(
    async (name: string, callback: (event: { payload: unknown }) => void) => {
      listeners.set(name, callback);
      return () => listeners.delete(name);
    },
  ),
}));

import { onJobEvent } from "../lib/engine/client";

describe("job events", () => {
  it("unwraps job events from the engine:event channel", async () => {
    const callback = vi.fn();
    await onJobEvent(callback);

    const listener = listeners.get("engine:event");
    expect(listener).toBeTypeOf("function");

    listener?.({
      payload: {
        v: 1,
        event: "job.progress",
        seq: 4,
        data: { jobId: "job-1", percent: 42 },
      },
    });

    expect(callback).toHaveBeenCalledWith({
      event: "job.progress",
      data: { jobId: "job-1", percent: 42 },
    });
  });

  it("ignores unrelated engine events", async () => {
    const callback = vi.fn();
    await onJobEvent(callback);
    listeners.get("engine:event")?.({
      payload: { v: 1, event: "engine.log", data: { message: "hi" } },
    });
    expect(callback).not.toHaveBeenCalled();
  });
});
