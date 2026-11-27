import { useEffect, useRef, useState } from "react";
import { ChevronRight, RefreshCw } from "lucide-react";
import { Button, EmptyState, ErrorNotice } from "../components/ui";
import { SegmentedTabs } from "../components/SegmentedTabs";
import { StatusDot } from "../components/StatusDot";
import { ActivityJob } from "./ActivityJob";
import type { JobSummary } from "../lib/engine/types";
import type { JobsState } from "../lib/engine/useJobs";
import { formatCount, relativeTime, shortenPath } from "../lib/format";
import { JOB_STATUS } from "../lib/jobLabels";

const TERMINAL = new Set([
  "completed",
  "completed_with_failures",
  "cancelled",
  "failed",
]);

function JobListRow({
  job,
  onOpen,
  action,
}: {
  job: JobSummary;
  onOpen: () => void;
  action?: React.ReactNode;
}) {
  const status = JOB_STATUS[job.status];
  return (
    <div className="flex items-center gap-3 px-2 py-1.5">
      <button
        type="button"
        onClick={onOpen}
        className="group flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-[10px] px-2.5 py-2.5 text-left transition-colors duration-150 hover:bg-white/[0.035] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-photon-400"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2.5">
            <StatusDot tone={status.tone} label={status.label} />
            <span className="text-[12px] tabular-nums text-stone-400">
              {relativeTime(job.createdAt)}
            </span>
          </div>
          <p
            className="mt-1.5 truncate font-mono text-[13px] text-stone-200"
            title={job.root}
          >
            {job.selection && job.selection.length > 1
              ? `${job.selection.length} locations · ${shortenPath(job.root)}`
              : shortenPath(job.root)}
          </p>
          <p className="mt-1 text-[13px] tabular-nums text-stone-400">
            {formatCount(job.completedFiles + job.skippedFiles)} of{" "}
            {formatCount(job.totalFiles)} files
            {job.failedFiles > 0 && ` · ${job.failedFiles} couldn't upload`}
            {(job.retryableFiles ?? 0) > 0 &&
              ` · ${job.retryableFiles} can be retried`}
            {job.uncertainFiles > 0 &&
              ` · ${job.uncertainFiles} need checking`}
          </p>
        </div>
        <ChevronRight className="size-4 shrink-0 text-stone-500 transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-stone-300" />
      </button>
      {action}
    </div>
  );
}

export function Activity({
  jobs,
  onOpenJob,
  onCloseJob,
  onCancel,
  onRetry,
  onResume,
  onReconnect,
  onChooseFolder,
}: {
  jobs: JobsState;
  onOpenJob: (jobId: string) => void;
  onCloseJob: () => void;
  onCancel: () => void;
  onRetry: (jobId: string, includeUncertain: boolean) => void;
  onResume: (jobId: string) => void;
  onReconnect: () => void;
  onChooseFolder: () => void;
}) {
  const [tab, setTab] = useState<"progress" | "past">("progress");

  const finishedJob =
    jobs.job && TERMINAL.has(jobs.job.status) ? jobs.job : null;
  const wasRunning = useRef(false);

  // When the running backup finishes, move it to Past instead of leaving the
  // In progress tab on a sudden empty state. Only on the running -> finished
  // transition, so the user can still browse the In progress tab afterwards.
  useEffect(() => {
    if (jobs.job && jobs.job.finishedAt === null) {
      wasRunning.current = true;
      return;
    }
    if (wasRunning.current && finishedJob) {
      wasRunning.current = false;
      setTab("past");
    }
  }, [jobs.job, finishedJob]);

  if (jobs.selectedJob) {
    const selected = jobs.selectedJob;
    return (
      <ActivityJob
        job={selected}
        active={false}
        authRequired={
          selected.id === jobs.job?.id
            ? jobs.authRequired
            : selected.status === "needs_auth"
        }
        onBack={onCloseJob}
        onCancel={onCancel}
        onRetry={(includeUncertain) => {
          onRetry(selected.id, includeUncertain);
          setTab("progress");
        }}
        onResume={() => {
          onResume(selected.id);
          setTab("progress");
        }}
        onReconnect={onReconnect}
      />
    );
  }

  const activeJob =
    jobs.job && !TERMINAL.has(jobs.job.status) ? jobs.job : null;
  const recovered = jobs.recovered.filter((job) => job.id !== activeJob?.id);
  const past = jobs.history.filter((job) => TERMINAL.has(job.status));
  const inProgressCount = (activeJob ? 1 : 0) + recovered.length;

  return (
    <div className="mx-auto w-full max-w-3xl px-8 py-9">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[34px] leading-tight text-stone-50">Activity</h1>
          <p className="mt-1.5 text-sm text-stone-400">
            Current and past backups, saved on this computer.
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void jobs.loadHistory()}
        >
          <RefreshCw className="size-3.5" />
          Refresh
        </Button>
      </div>

      <div className="mt-6">
        <SegmentedTabs
          tabs={[
            { id: "progress", label: "In progress", count: inProgressCount },
            { id: "past", label: "Past", count: past.length },
          ]}
          active={tab}
          onChange={(id) => setTab(id as "progress" | "past")}
        />
      </div>

      {jobs.error && (
        <div className="mt-5">
          <ErrorNotice
            error={jobs.error}
            onRetry={() => void jobs.loadHistory()}
            retryLabel="Refresh"
          />
        </div>
      )}

      {tab === "progress" && (
        <section className="mt-6">
          {activeJob ? (
            <ActivityJob
              job={activeJob}
              active
              authRequired={jobs.authRequired}
              onCancel={onCancel}
              onRetry={(includeUncertain) =>
                onRetry(activeJob.id, includeUncertain)
              }
              onResume={() => onResume(activeJob.id)}
              onReconnect={onReconnect}
            />
          ) : recovered.length > 0 ? (
            <>
              <p className="text-[13px] text-stone-400">
                These backups were interrupted or need a new connection.
              </p>
              <div className="surface-panel mt-3 divide-y divide-white/[0.06] rounded-[14px]">
                {recovered.map((job) => (
                  <JobListRow
                    key={job.id}
                    job={job}
                    onOpen={() => onOpenJob(job.id)}
                    action={
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          onResume(job.id);
                          setTab("progress");
                        }}
                      >
                        Resume
                      </Button>
                    }
                  />
                ))}
              </div>
            </>
          ) : (
            <EmptyState
              title="No backup running"
              body="Choose folders or photos to start a backup. You'll review everything first."
              action="Choose folders"
              onAction={onChooseFolder}
            />
          )}
        </section>
      )}

      {tab === "past" && (
        <section className="mt-6">
          {past.length === 0 ? (
            <EmptyState
              title="Nothing here yet"
              body="Finished backups will appear here with what happened to every file."
              action="Start a backup"
              onAction={onChooseFolder}
            />
          ) : (
            <div className="surface-panel divide-y divide-white/[0.06] rounded-[14px]">
              {past.map((job) => (
                <JobListRow
                  key={job.id}
                  job={job}
                  onOpen={() => onOpenJob(job.id)}
                />
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
