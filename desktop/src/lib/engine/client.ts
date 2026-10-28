/** Typed bridge from React to the Rust controller. */
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  isEngineError,
  type AuthEvent,
  type AuthStatus,
  type DeviceCheck,
  type EngineError,
  type EngineEventEnvelope,
  type EngineInfo,
  type EngineStatus,
  type JobEventEnvelope,
  type JobSnapshot,
  type JobSummary,
  type ScanResult,
} from "./types";

/** Normalize anything `invoke` throws into the engine's error shape. */
export function toEngineError(error: unknown): EngineError {
  if (isEngineError(error)) {
    return {
      code: error.code ?? "unknown",
      message: error.message,
      recoverable: Boolean(error.recoverable),
      hint: error.hint,
    };
  }
  if (typeof error === "string") {
    return { code: "unknown", message: error, recoverable: false };
  }
  if (error instanceof Error) {
    return { code: "unknown", message: error.message, recoverable: false };
  }
  return {
    code: "unknown",
    message: "An unexpected error occurred.",
    recoverable: false,
  };
}

async function invokeEngine<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    throw toEngineError(error);
  }
}

export function engineStatus(): Promise<EngineStatus> {
  return invokeEngine<EngineStatus>("engine_status");
}

export function engineStart(): Promise<EngineStatus> {
  return invokeEngine<EngineStatus>("engine_start");
}

export function engineStop(): Promise<EngineStatus> {
  return invokeEngine<EngineStatus>("engine_stop");
}

/** Only the methods allowlisted in `src-tauri/src/commands.rs` are reachable. */
export function engineCall<T>(
  method:
    | "ping"
    | "engine_info"
    | "scan_folder"
    | "scan_selection"
    | "get_job"
    | "cancel_job"
    | "list_jobs"
    | "clear_history",
  params: Record<string, unknown> = {},
): Promise<T> {
  return invokeEngine<T>("engine_call", { method, params });
}

export function engineInfo(): Promise<EngineInfo> {
  return engineCall<EngineInfo>("engine_info");
}

export function scanFolder(
  path: string,
  options: { includeHidden?: boolean; maxFiles?: number } = {},
): Promise<ScanResult> {
  return engineCall<ScanResult>("scan_folder", { path, ...options });
}

/** Scan an explicit selection of files and folders into one review. */
export function scanSelection(
  paths: string[],
  options: { includeHidden?: boolean; maxFiles?: number } = {},
): Promise<ScanResult> {
  return engineCall<ScanResult>("scan_selection", { paths, ...options });
}

export function onEngineEvent(
  callback: (event: EngineEventEnvelope) => void,
): Promise<UnlistenFn> {
  return listen<EngineEventEnvelope>("engine:event", (event) =>
    callback(event.payload),
  );
}

export function onEngineStatus(
  callback: (status: EngineStatus) => void,
): Promise<UnlistenFn> {
  return listen<EngineStatus>("engine:status", (event) =>
    callback(event.payload),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Authentication
// ─────────────────────────────────────────────────────────────────────────────

export function authStatus(): Promise<AuthStatus> {
  return invokeEngine<AuthStatus>("auth_status");
}

export function authDeviceCheck(): Promise<DeviceCheck> {
  return invokeEngine<DeviceCheck>("auth_device_check");
}

export function authCaptureStart(): Promise<AuthEvent> {
  return invokeEngine<AuthEvent>("auth_capture_start");
}

export function authCaptureCancel(): Promise<AuthEvent> {
  return invokeEngine<AuthEvent>("auth_capture_cancel");
}

export function authClear(): Promise<AuthStatus> {
  return invokeEngine<AuthStatus>("auth_clear");
}

export function onAuthStatus(
  callback: (event: AuthEvent) => void,
): Promise<UnlistenFn> {
  return listen<AuthEvent>("auth:status", (event) => callback(event.payload));
}

// ─────────────────────────────────────────────────────────────────────────────
// Upload jobs
// ─────────────────────────────────────────────────────────────────────────────

export interface ReviewedFile {
  absPath: string;
  path: string;
  size: number;
  mediaType: "image" | "video";
  mtime: number;
}

export interface StartUploadRequest {
  /** A single root or an explicit multi-file/folder selection. */
  path?: string;
  paths?: string[];
  /** The exact list shown in Review; avoids a second folder scan. */
  files?: ReviewedFile[];
  albumPolicy: "timeline" | "per_job" | "per_folder";
  albumName?: string | null;
  includeHidden?: boolean;
  maxFiles?: number;
}

/** Starts a job; the controller injects the keyring token (never the UI). */
export function startUpload(request: StartUploadRequest): Promise<JobSnapshot> {
  return invokeEngine<JobSnapshot>("upload_start", { request });
}

export function getJob(jobId: string): Promise<JobSnapshot> {
  return engineCall<JobSnapshot>("get_job", { jobId });
}

export function cancelJob(jobId: string): Promise<JobSnapshot> {
  return engineCall<JobSnapshot>("cancel_job", { jobId });
}

export function listJobs(): Promise<{ jobs: JobSummary[] }> {
  return engineCall<{ jobs: JobSummary[] }>("list_jobs");
}

/** Delete finished jobs from the local history. Never touches Google Photos. */
export function clearHistory(): Promise<{ removed: number }> {
  return engineCall<{ removed: number }>("clear_history");
}

/** Token-bearing actions are dedicated commands, never engine_call. */
export function retryFailed(
  jobId: string,
  includeUncertain = false,
): Promise<JobSnapshot> {
  return invokeEngine<JobSnapshot>("upload_retry", {
    request: { jobId, includeUncertain },
  });
}

export function resumeJob(jobId: string): Promise<JobSnapshot> {
  return invokeEngine<JobSnapshot>("upload_resume", {
    request: { jobId },
  });
}

const JOB_EVENTS = [
  "job.created",
  "job.progress",
  "file.updated",
  "job.completed",
  "job.failed",
  "auth.required",
] as const;

/**
 * Job events arrive inside the engine's single `engine:event` channel. The
 * payload is `{ v, event, seq, data }`; unwrap it here so callers never miss
 * an update by listening on a channel the controller does not emit.
 */
export async function onJobEvent(
  callback: (event: JobEventEnvelope) => void,
): Promise<UnlistenFn> {
  return onEngineEvent((envelope) => {
    if (!(JOB_EVENTS as readonly string[]).includes(envelope.event)) return;
    callback({ event: envelope.event, data: envelope.data });
  });
}
