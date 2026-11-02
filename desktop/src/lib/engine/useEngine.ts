/** Read-only engine state for the UI. Starts the sidecar lazily on mount. */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  engineInfo,
  engineStart,
  engineStatus,
  onEngineEvent,
  onEngineStatus,
  toEngineError,
} from "./client";
import type { EngineError, EngineInfo, EngineStatus } from "./types";

export interface EngineState {
  status: EngineStatus | null;
  info: EngineInfo | null;
  error: EngineError | null;
  loading: boolean;
  logs: string[];
  refresh: () => Promise<void>;
}

function logMessage(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const message = (data as { message?: unknown }).message;
  return typeof message === "string" ? message : null;
}

export function useEngine(): EngineState {
  const [status, setStatus] = useState<EngineStatus | null>(null);
  const [info, setInfo] = useState<EngineInfo | null>(null);
  const [error, setError] = useState<EngineError | null>(null);
  const [loading, setLoading] = useState(true);
  const [logs, setLogs] = useState<string[]>([]);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    if (!mounted.current) return;
    setLoading(true);
    try {
      let current = await engineStatus();
      if (!current.running) {
        current = await engineStart();
      }
      if (!mounted.current) return;
      setStatus(current);
      const details = await engineInfo();
      if (!mounted.current) return;
      setInfo(details);
      setError(null);
    } catch (caught) {
      if (mounted.current) setError(toEngineError(caught));
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    const unlisteners: Array<() => void> = [];

    void refresh();

    void onEngineStatus((next) => {
      if (mounted.current) setStatus(next);
    }).then((unlisten) => {
      if (mounted.current) unlisteners.push(unlisten);
      else unlisten();
    });

    void onEngineEvent((event) => {
      if (event.event !== "engine.log" || !mounted.current) return;
      const message = logMessage(event.data);
      if (!message) return;
      setLogs((previous) => [...previous.slice(-49), message]);
    }).then((unlisten) => {
      if (mounted.current) unlisteners.push(unlisten);
      else unlisten();
    });

    return () => {
      mounted.current = false;
      for (const unlisten of unlisteners) unlisten();
    };
  }, [refresh]);

  return { status, info, error, loading, logs, refresh };
}
