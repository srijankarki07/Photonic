/** Upload job state driven by engine events. */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  cancelJob,
  getJob,
  listJobs,
  onJobEvent,
  resumeJob as resumeJobRequest,
  retryFailed as retryFailedRequest,
  startUpload,
  toEngineError,
  type StartUploadRequest,
} from "./client";
import type {
  AuthRequiredEvent,
  EngineError,
  FileUpdatedEvent,
  JobCompletedEvent,
  JobFailedEvent,
  JobProgressEvent,
  JobSnapshot,
  JobSummary,
} from "./types";

export interface JobsState {
  job: JobSnapshot | null;
  selectedJob: JobSnapshot | null;
  history: JobSummary[];
  recovered: JobSummary[];
  error: EngineError | null;
  starting: boolean;
  authRequired: boolean;
  start: (request: StartUploadRequest) => Promise<string | null>;
  cancel: () => Promise<void>;
  retryFailed: (includeUncertain: boolean, jobId?: string) => Promise<void>;
  resume: (jobId?: string) => Promise<void>;
  loadHistory: () => Promise<void>;
  openJob: (jobId: string) => Promise<void>;
  closeJob: () => void;
  refresh: (jobId?: string) => Promise<void>;
  clear: () => void;
}

function isRecoverable(job: JobSummary): boolean {
  if (job.status === "interrupted") return true;
  if (job.status !== "needs_auth") return false;
  return (
    job.pendingFiles +
      job.failedFiles +
      (job.retryableFiles ?? 0) >
    0
  );
}

export function useJobs(): JobsState {
  const [job, setJob] = useState<JobSnapshot | null>(null);
  const [selectedJob, setSelectedJob] = useState<JobSnapshot | null>(null);
  const [history, setHistory] = useState<JobSummary[]>([]);
  const [recovered, setRecovered] = useState<JobSummary[]>([]);
  const [error, setError] = useState<EngineError | null>(null);
  const [starting, setStarting] = useState(false);
  const [authRequiredState, setAuthRequiredState] = useState(false);
  const jobIdRef = useRef<string | null>(null);
  const mounted = useRef(true);

  const refresh = useCallback(async (jobId?: string) => {
    const id = jobId ?? jobIdRef.current;
    if (!id) return;
    try {
      const snapshot = await getJob(id);
      if (jobIdRef.current === id) setJob(snapshot);
    } catch (caught) {
      setError(toEngineError(caught));
    }
  }, []);

  const loadHistory = useCallback(async () => {
    try {
      const { jobs } = await listJobs();
      if (!mounted.current) return;
      setHistory(jobs);
      setRecovered(jobs.filter(isRecoverable));
      setSelectedJob((previous) => {
        if (!previous) return previous;
        const summary = jobs.find((item) => item.id === previous.id);
        return summary ? { ...previous, ...summary } : previous;
      });

      // A webview reload during a backup keeps the engine running. Adopt the
      // live job so its progress and file updates continue to arrive. History
      // rows omit files, so fetch the full snapshot once.
      const running = jobs.find((item) => item.finishedAt === null);
      if (running && (!jobIdRef.current || jobIdRef.current === running.id)) {
        jobIdRef.current = running.id;
        void refresh(running.id);
      }
    } catch {
      // The engine may still be starting; the app retries when it is ready.
    }
  }, [refresh]);

  const openJob = useCallback(async (jobId: string) => {
    try {
      const snapshot = await getJob(jobId);
      setSelectedJob(snapshot);
      setError(null);
    } catch (caught) {
      setError(toEngineError(caught));
    }
  }, []);

  const closeJob = useCallback(() => {
    setSelectedJob(null);
  }, []);

  const start = useCallback(
    async (request: StartUploadRequest): Promise<string | null> => {
      setStarting(true);
      setError(null);
      setAuthRequiredState(false);
      try {
        const snapshot = await startUpload(request);
        jobIdRef.current = snapshot.id;
        setJob(snapshot);
        setSelectedJob(null);
        // Events may have landed before the request resolved. Re-read the
        // authoritative state so a very fast job cannot leave the queue stale.
        void refresh(snapshot.id);
        void loadHistory();
        return snapshot.id;
      } catch (caught) {
        setError(toEngineError(caught));
        return null;
      } finally {
        setStarting(false);
      }
    },
    [refresh, loadHistory],
  );

  const cancel = useCallback(async () => {
    const id = jobIdRef.current;
    if (!id) return;
    try {
      const snapshot = await cancelJob(id);
      if (jobIdRef.current === id) setJob(snapshot);
    } catch (caught) {
      setError(toEngineError(caught));
    }
  }, []);

  const clear = useCallback(() => {
    jobIdRef.current = null;
    setJob(null);
    setSelectedJob(null);
    setError(null);
    setAuthRequiredState(false);
  }, []);

  const retryFailed = useCallback(
    async (includeUncertain: boolean, jobId?: string) => {
      const id = jobId ?? jobIdRef.current;
      if (!id) return;
      try {
        const snapshot = await retryFailedRequest(id, includeUncertain);
        jobIdRef.current = snapshot.id;
        setJob(snapshot);
        setSelectedJob(null);
        setError(null);
        setAuthRequiredState(false);
        void loadHistory();
      } catch (caught) {
        setError(toEngineError(caught));
      }
    },
    [loadHistory],
  );

  const resume = useCallback(
    async (jobId?: string) => {
      const id = jobId ?? jobIdRef.current;
      if (!id) return;
      try {
        const snapshot = await resumeJobRequest(id);
        jobIdRef.current = snapshot.id;
        setJob(snapshot);
        setSelectedJob(null);
        setError(null);
        setAuthRequiredState(false);
        void loadHistory();
      } catch (caught) {
        setError(toEngineError(caught));
      }
    },
    [loadHistory],
  );

  useEffect(() => {
    mounted.current = true;
    let disposed = false;
    let unlisten: (() => void) | undefined;

    void loadHistory();
    void onJobEvent(({ event, data }) => {
      const current = jobIdRef.current;

      const patchFor = (
        id: string,
        updater: (snapshot: JobSnapshot) => JobSnapshot,
      ) => {
        setJob((previous) =>
          previous && previous.id === id ? updater(previous) : previous,
        );
        setSelectedJob((previous) =>
          previous && previous.id === id ? updater(previous) : previous,
        );
      };

      if (event === "job.progress") {
        const progress = data as JobProgressEvent;
        patchFor(progress.jobId, (previous) => ({
          ...previous,
          status: progress.status,
          totalFiles: progress.totalFiles,
          completedFiles: progress.completedFiles,
          failedFiles: progress.failedFiles,
          uncertainFiles: progress.uncertainFiles,
          skippedFiles: progress.skippedFiles,
          retryableFiles: progress.retryableFiles,
          processingVideos: progress.processingVideos,
          uploadingFiles: progress.uploadingFiles,
          pendingFiles: progress.pendingFiles,
          totalBytes: progress.totalBytes,
          bytesCompleted: progress.bytesCompleted,
          percent: progress.percent,
          bytesPerSecond: progress.bytesPerSecond ?? 0,
        }));
        return;
      }

      if (event === "file.updated") {
        const update = data as FileUpdatedEvent;
        patchFor(update.jobId, (previous) => {
          const matches = (file: (typeof previous.files)[number]) =>
            update.fileId
              ? file.fileId === update.fileId
              : file.path === update.path;
          const files = previous.files.map((file) =>
            matches(file) ? { ...file, ...update } : file,
          );
          return { ...previous, files };
        });
        return;
      }

      if (event === "job.completed") {
        const completed = data as JobCompletedEvent;
        patchFor(completed.jobId, (previous) => ({
          ...previous,
          status: completed.status,
          completedFiles: completed.completedFiles,
          failedFiles: completed.failedFiles,
          uncertainFiles: completed.uncertainFiles,
          skippedFiles: completed.skippedFiles,
          retryableFiles:
            completed.retryableFiles ?? previous.retryableFiles,
          processingVideos:
            completed.processingVideos ?? previous.processingVideos,
          totalFiles: completed.totalFiles,
        }));
        void refresh(completed.jobId);
        void loadHistory();
        return;
      }

      if (event === "job.failed") {
        const failed = data as JobFailedEvent;
        patchFor(failed.jobId, (previous) => ({
          ...previous,
          status: "failed",
        }));
        if (failed.jobId === current) {
          setError({
            code: "job_failed",
            message: failed.error,
            recoverable: true,
            hint: "Open Activity to see what happened, then try again.",
          });
        }
        void loadHistory();
        return;
      }

      if (event === "auth.required") {
        const required = data as AuthRequiredEvent;
        patchFor(required.jobId, (previous) => ({
          ...previous,
          status: "needs_auth",
        }));
        if (required.jobId === current) setAuthRequiredState(true);
      }
    })
      .then((stop) => {
        if (disposed) stop();
        else unlisten = stop;
      })
      .catch(() => {
        // No Tauri runtime (browser preview); the queue stays empty.
      });

    return () => {
      mounted.current = false;
      disposed = true;
      unlisten?.();
    };
  }, [refresh, loadHistory]);

  return {
    job,
    selectedJob,
    history,
    recovered,
    error,
    starting,
    authRequired: authRequiredState || job?.status === "needs_auth",
    start,
    cancel,
    retryFailed,
    resume,
    loadHistory,
    openJob,
    closeJob,
    refresh,
    clear,
  };
}
