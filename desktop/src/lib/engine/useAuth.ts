/** Authentication state for the Connect wizard. */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  authCaptureCancel,
  authCaptureStart,
  authClear,
  authDeviceCheck,
  authStatus,
  onAuthStatus,
  toEngineError,
} from "./client";
import type { AuthPhase, AuthStatus, DeviceCheck } from "./types";

export interface AuthState {
  status: AuthStatus | null;
  device: DeviceCheck | null;
  phase: AuthPhase | string | null;
  message: string | null;
  error: string | null;
  hint: string | null;
  busy: boolean;
  loading: boolean;
  refresh: () => Promise<void>;
  checkDevice: () => Promise<void>;
  startCapture: () => Promise<void>;
  cancelCapture: () => Promise<void>;
  disconnect: () => Promise<void>;
}

export function useAuth(): AuthState {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [device, setDevice] = useState<DeviceCheck | null>(null);
  const [phase, setPhase] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const next = await authStatus();
      if (!mounted.current) return;
      setStatus(next);
      if (next.error) {
        setError(next.error);
        setHint(next.errorHint);
      }
    } catch (caught) {
      if (!mounted.current) return;
      const normalized = toEngineError(caught);
      setError(normalized.message);
      setHint(normalized.hint ?? null);
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    let unlisten: (() => void) | undefined;
    void refresh();

    void onAuthStatus((event) => {
      if (!mounted.current) return;
      setPhase(event.phase);
      setMessage(event.message);
      if (event.phase === "connected") {
        setBusy(false);
        setError(null);
        setHint(null);
        setStatus((previous) =>
          previous
            ? {
                ...previous,
                connected: true,
                emailMasked: event.emailMasked ?? previous.emailMasked,
                keyringAvailable: true,
                error: null,
                errorHint: null,
              }
            : previous,
        );
        void refresh();
      } else if (event.phase === "error") {
        setBusy(false);
        setError(event.message);
        setHint(event.error);
      } else if (event.phase === "cancelled") {
        setBusy(false);
      } else if (event.phase === "cancelling") {
        setBusy(true);
      }
    }).then((stop) => {
      if (mounted.current) unlisten = stop;
      else stop();
    });

    return () => {
      mounted.current = false;
      unlisten?.();
    };
  }, [refresh]);

  const checkDevice = useCallback(async () => {
    setError(null);
    setHint(null);
    try {
      const result = await authDeviceCheck();
      if (mounted.current) setDevice(result);
      if (!result.adbFound) {
        setError(result.message);
        setHint("Install android-tools-adb and try again.");
      }
    } catch (caught) {
      const normalized = toEngineError(caught);
      setError(normalized.message);
      setHint(normalized.hint ?? null);
    }
  }, []);

  const startCapture = useCallback(async () => {
    setBusy(true);
    setError(null);
    setHint(null);
    try {
      const event = await authCaptureStart();
      if (mounted.current) {
        setPhase(event.phase);
        setMessage(event.message);
      }
    } catch (caught) {
      const normalized = toEngineError(caught);
      setBusy(false);
      setError(normalized.message);
      setHint(normalized.hint ?? null);
    }
  }, []);

  const cancelCapture = useCallback(async () => {
    try {
      const event = await authCaptureCancel();
      setPhase(event.phase);
      setMessage(event.message);
    } catch (caught) {
      const normalized = toEngineError(caught);
      setError(normalized.message);
      setHint(normalized.hint ?? null);
    }
  }, []);

  const disconnect = useCallback(async () => {
    setError(null);
    setHint(null);
    try {
      const next = await authClear();
      if (!mounted.current) return;
      setStatus(next);
      setPhase(null);
      setMessage(null);
      setDevice(null);
    } catch (caught) {
      const normalized = toEngineError(caught);
      setError(normalized.message);
      setHint(normalized.hint ?? null);
    }
  }, []);

  return {
    status,
    device,
    phase,
    message,
    error,
    hint,
    busy,
    loading,
    refresh,
    checkDevice,
    startCapture,
    cancelCapture,
    disconnect,
  };
}
