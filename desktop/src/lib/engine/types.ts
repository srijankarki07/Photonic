/** Shared types mirroring the engine protocol and Rust commands. */

export interface EngineError {
  code: string;
  message: string;
  recoverable: boolean;
  hint?: string;
}

export interface EngineStatus {
  running: boolean;
  ready: boolean;
  pid: number | null;
  restartCount: number;
  lastError: string | null;
  engineBin: string | null;
  protocolVersion: number;
}

export interface BinaryInfo {
  name: string;
  path: string | null;
  version: string | null;
  found: boolean;
}

export interface EngineInfo {
  engine: string;
  version: string;
  protocolVersion: number;
  python: string;
  platform: string;
  binaries: {
    gpmc: BinaryInfo;
    gpd: BinaryInfo;
  };
  ffmpeg: { path: string | null; found: boolean };
  ready: boolean;
  dataDir: string;
  databasePath: string;
  logFile: string;
  capabilities: string[];
  requiredCapabilities: string[];
}

export type MediaType = "image" | "video";

export interface MediaFile {
  path: string;
  absPath: string;
  size: number;
  mediaType: MediaType;
  mtime: number;
  state: string;
  remoteId: string | null;
  lastError: string | null;
}

export interface ScanSkip {
  path: string;
  reason: string;
}

export interface ScanResult {
  root: string;
  mediaCount: number;
  totalBytes: number;
  directoryCount: number;
  partial: boolean;
  skippedCount: number;
  skipped: ScanSkip[];
  warnings: ScanSkip[];
  files: MediaFile[];
}

export interface EngineEventEnvelope {
  v: number;
  event: string;
  seq?: number;
  data: unknown;
}

export interface AuthStatus {
  connected: boolean;
  emailMasked: string | null;
  capturedAt: number | null;
  expiresAt: number | null;
  keyringAvailable: boolean;
  error: string | null;
  errorHint: string | null;
}

export type AuthPhase =
  | "checking_adb"
  | "waiting_for_device"
  | "waiting_for_authorization"
  | "waiting_for_screen"
  | "capturing"
  | "connected"
  | "cancelled"
  | "cancelling"
  | "error";

export interface AuthEvent {
  phase: AuthPhase | string;
  message: string;
  emailMasked: string | null;
  error: string | null;
  code: string | null;
}

export interface AdbDevice {
  serial: string;
  state: string;
}

export interface DeviceCheck {
  adbFound: boolean;
  devices: AdbDevice[];
  message: string;
}

export type JobStatus =
  | "queued"
  | "uploading"
  | "cancelling"
  | "needs_auth"
  | "completed"
  | "completed_with_failures"
  | "cancelled"
  | "failed"
  | "interrupted";

export type JobFileState =
  | "pending"
  | "validating"
  | "uploading"
  | "completed"
  | "skipped"
  | "failed"
  | "retryable"
  | "uncertain"
  | "cancelled";

export interface JobFile {
  /** Stable identity; present on newer engines/events. */
  fileId?: string;
  absPath?: string;
  path: string;
  size: number;
  mediaType: MediaType;
  state: JobFileState;
  attempts: number;
  remoteId: string | null;
  error: string | null;
  code: string | null;
  hint: string | null;
  phase: string | null;
  bytesCompleted: number;
  bytesTotal: number;
  processingHint: string | null;
  updatedAt: number;
  /** Present on `file.updated` events only. */
  jobId?: string;
}

export interface JobSnapshot {
  id: string;
  root: string;
  albumPolicy: string;
  albumName: string | null;
  status: JobStatus;
  createdAt: number;
  updatedAt: number;
  finishedAt: number | null;
  lastError: string | null;
  selection?: string[];
  totalFiles: number;
  completedFiles: number;
  failedFiles: number;
  uncertainFiles: number;
  skippedFiles: number;
  retryableFiles: number;
  processingVideos: number;
  uploadingFiles: number;
  pendingFiles: number;
  totalBytes: number;
  bytesCompleted: number;
  percent: number;
  bytesPerSecond?: number;
  filesTruncated?: boolean;
  files: JobFile[];
}

/** History rows omit the per-file list; open a job to load it. */
export type JobSummary = Omit<JobSnapshot, "files">;

export interface JobCreatedEvent {
  jobId: string;
  root: string;
  selection?: string[];
  totalFiles: number;
  totalBytes: number;
  albumPolicy: string;
}

export interface JobProgressEvent {
  jobId: string;
  status: JobStatus;
  totalFiles: number;
  completedFiles: number;
  failedFiles: number;
  uncertainFiles: number;
  skippedFiles: number;
  retryableFiles: number;
  processingVideos: number;
  uploadingFiles: number;
  pendingFiles: number;
  totalBytes: number;
  bytesCompleted: number;
  percent: number;
  bytesPerSecond?: number;
}

export interface FileUpdatedEvent extends JobFile {
  jobId: string;
}

export interface JobCompletedEvent {
  jobId: string;
  status: JobStatus;
  completedFiles: number;
  failedFiles: number;
  uncertainFiles: number;
  skippedFiles: number;
  retryableFiles?: number;
  processingVideos?: number;
  totalFiles: number;
  duration: number;
}

export interface JobFailedEvent {
  jobId: string;
  error: string;
  status: JobStatus;
}

export interface AuthRequiredEvent {
  jobId: string;
  reason: string;
}

export interface JobEventEnvelope {
  event: string;
  data: unknown;
}

export function isEngineError(value: unknown): value is EngineError {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<EngineError>;
  return typeof candidate.message === "string";
}
