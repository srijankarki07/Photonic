import type { JobFileState, JobStatus } from "./engine/types";

export type JobTone = "good" | "warn" | "danger" | "muted";

export const JOB_STATUS: Record<
  JobStatus,
  { label: string; tone: JobTone }
> = {
  queued: { label: "Waiting", tone: "muted" },
  uploading: { label: "Uploading", tone: "warn" },
  cancelling: { label: "Stopping", tone: "warn" },
  needs_auth: { label: "Needs connection", tone: "danger" },
  completed: { label: "Uploaded", tone: "good" },
  completed_with_failures: { label: "Some files didn't upload", tone: "warn" },
  cancelled: { label: "Stopped", tone: "muted" },
  failed: { label: "Couldn't upload", tone: "danger" },
  interrupted: { label: "Interrupted", tone: "warn" },
};

export const FILE_STATE: Record<
  JobFileState,
  { label: string; tone: JobTone }
> = {
  pending: { label: "Waiting", tone: "muted" },
  validating: { label: "Checking", tone: "warn" },
  uploading: { label: "Uploading", tone: "warn" },
  completed: { label: "Uploaded", tone: "good" },
  skipped: { label: "Won't be uploaded", tone: "muted" },
  failed: { label: "Couldn't upload", tone: "danger" },
  retryable: { label: "Will try again", tone: "warn" },
  uncertain: { label: "Needs checking", tone: "warn" },
  cancelled: { label: "Stopped", tone: "muted" },
};

export const FILE_ORDER: Record<JobFileState, number> = {
  uploading: 0,
  validating: 1,
  failed: 2,
  retryable: 3,
  uncertain: 4,
  pending: 5,
  cancelled: 6,
  completed: 7,
  skipped: 8,
};
