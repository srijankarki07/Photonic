import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Check,
  Copy,
  Play,
  RefreshCw,
  RotateCcw,
  X,
} from "lucide-react";
import { Button } from "../components/ui";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Disclosure } from "../components/Disclosure";
import { MediaRow } from "../components/MediaRow";
import { StatusDot } from "../components/StatusDot";
import type { JobFile, JobSnapshot } from "../lib/engine/types";
import {
  FILE_STATE,
  JOB_STATUS,
} from "../lib/jobLabels";
import {
  basename,
  formatBytes,
  formatCount,
  formatSpeed,
  parentFolder,
  relativeTime,
  shortenPath,
} from "../lib/format";
import { skipReason } from "../lib/messages";

function fileMeta(file: JobFile): string | undefined {
  const percent =
    file.bytesTotal > 0
      ? Math.round((file.bytesCompleted / file.bytesTotal) * 100)
      : 0;
  if (file.state === "uploading") return `${percent}%`;
  if (file.state === "validating") return "Checking the file";
  if (file.state === "skipped") return skipReason(file.code ?? "skipped");
  if (file.state === "failed" || file.state === "retryable") {
    return file.error ?? skipReason(file.code ?? "upload failed");
  }
  if (file.state === "uncertain") return "Google may already have this file";
  if (file.state === "completed" && file.processingHint) {
    return "Google may still process this video";
  }
  return undefined;
}

export function ActivityJob({
  job,
  authRequired,
  active,
  onBack,
  onCancel,
  onRetry,
  onResume,
  onReconnect,
}: {
  job: JobSnapshot;
  authRequired: boolean;
  active: boolean;
  onBack?: () => void;
  onCancel: () => void;
  onRetry: (includeUncertain: boolean) => void;
  onResume: () => void;
  onReconnect: () => void;
}) {
  const [limit, setLimit] = useState(200);
  const [confirmUncertain, setConfirmUncertain] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    setLimit(200);
    setConfirmUncertain(false);
    setCopied(null);
  }, [job.id]);

  const status = JOB_STATUS[job.status];
  const retryable = job.retryableFiles ?? 0;
  const canRetry = !active && (job.failedFiles > 0 || retryable > 0);
  const canUncertain = !active && job.uncertainFiles > 0;
  const canResume = job.status === "interrupted" || job.status === "needs_auth";
  const processingVideos = job.processingVideos ?? 0;
  const alreadyUploaded = job.files.filter(
    (file) => file.code === "already_uploaded",
  ).length;
  const sorted = useMemo(
    () => [...job.files].sort((left, right) => left.path.localeCompare(right.path)),
    [job.files],
  );
  const visible = sorted.slice(0, limit);
  const remaining = sorted.length - visible.length;
  const keys = job.files.filter((file) => file.remoteId).slice(0, 20);
  const rawErrors = job.files
    .filter((file) => file.code && file.state !== "completed")
    .slice(0, 20);

  async function copyKey(id: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(id);
      window.setTimeout(() => setCopied(null), 1800);
    } catch {
      setCopied(null);
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-8 py-8">
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          className="inline-flex cursor-pointer items-center gap-1.5 text-[13px] text-stone-500 transition hover:text-stone-200"
        >
          <ArrowLeft className="size-3.5" />
          Back to Activity
        </button>
      )}

      <div className="mt-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-[34px] leading-tight text-stone-50">
            Backup
          </h1>
          <p
            className="mt-1.5 truncate text-sm text-stone-500"
            title={job.root}
          >
            {job.selection && job.selection.length > 1
              ? `${job.selection.length} locations · ${shortenPath(job.root)}`
              : shortenPath(job.root)}
            {" · "}
            {relativeTime(job.createdAt)}
          </p>
        </div>
        <StatusDot tone={status.tone} label={status.label} />
      </div>

      <section className="mt-8">
        <div className="flex items-end justify-between gap-6">
          <div>
            <p className="font-display text-[48px] leading-none tabular-nums text-stone-50">
              {Math.round(job.percent)}
              <span className="ml-1 text-2xl text-stone-500">%</span>
            </p>
            <p className="mt-2 text-sm text-stone-400">
              {formatCount(job.completedFiles + job.skippedFiles)} of{" "}
              {formatCount(job.totalFiles)} files ·{" "}
              {formatBytes(job.bytesCompleted)} of {formatBytes(job.totalBytes)}
              {active && (job.bytesPerSecond ?? 0) > 0 && (
                <>
                  {" "}
                  · {formatSpeed(job.bytesPerSecond)}
                </>
              )}
            </p>
          </div>
          <div className="text-right text-[13px] text-stone-500">
            {job.failedFiles > 0 && <p>{job.failedFiles} couldn't upload</p>}
            {retryable > 0 && <p>{retryable} can be retried</p>}
            {job.uncertainFiles > 0 && (
              <p>{job.uncertainFiles} need checking</p>
            )}
            {job.skippedFiles > 0 && (
              <p>{job.skippedFiles} won't be uploaded</p>
            )}
            {alreadyUploaded > 0 && (
              <p>{alreadyUploaded} already in Google Photos</p>
            )}
          </div>
        </div>
        <div
          className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/[0.06]"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(job.percent)}
          aria-label={`Backup ${Math.round(job.percent)} percent complete`}
        >
          <div
            className="h-full rounded-full bg-photon-400 transition-[width] duration-300"
            style={{ width: `${Math.min(100, Math.max(0, job.percent))}%` }}
          />
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {active && job.status !== "cancelling" && (
            <Button variant="secondary" size="sm" onClick={onCancel}>
              <X className="size-3.5" />
              Stop backup
            </Button>
          )}
          {job.status === "cancelling" && (
            <StatusDot tone="warn" label="Stopping…" pulse />
          )}
          {canResume && (
            <Button variant="primary" size="sm" onClick={onResume}>
              <Play className="size-3.5" />
              Resume
            </Button>
          )}
          {canRetry && (
            <Button variant="secondary" size="sm" onClick={() => onRetry(false)}>
              <RefreshCw className="size-3.5" />
              Retry failed
            </Button>
          )}
          {canUncertain && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfirmUncertain(true)}
            >
              <RotateCcw className="size-3.5" />
              Check {job.uncertainFiles} unconfirmed
            </Button>
          )}
        </div>

        <p className="mt-3 text-[13px] leading-relaxed text-stone-500">
          {active
            ? "This backup is saved on this computer. You can close Photonic and resume it here later."
            : job.status === "completed"
              ? "Finished. Your originals stay untouched."
              : job.status === "completed_with_failures"
                ? "Some files need attention. Retry failed files, or check the unconfirmed ones."
                : job.status === "interrupted"
                  ? "Interrupted. Resume continues the remaining files; unconfirmed files need a decision."
                  : job.status === "needs_auth"
                    ? "Reconnect Google Photos, then resume or retry."
                    : job.status === "cancelled"
                      ? "Stopped. Nothing else will upload from this backup."
                      : "This backup stopped before finishing."}
        </p>
        {processingVideos > 0 && (
          <p className="mt-1 text-[13px] leading-relaxed text-stone-500">
            {processingVideos} video{processingVideos === 1 ? "" : "s"} uploaded
            and may still be processing in Google Photos. That isn't a failure.
          </p>
        )}
      </section>

      {(authRequired || job.status === "needs_auth") && (
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-[14px] bg-red-400/[0.05] px-4 py-3">
          <p className="text-sm text-red-200/80">
            Google Photos needs reconnecting before this backup can continue.
          </p>
          <Button variant="secondary" size="sm" onClick={onReconnect}>
            Reconnect
          </Button>
        </div>
      )}

      <section className="mt-8">
        <div className="flex items-center justify-between border-b border-white/[0.06] pb-3">
          <h2 className="text-sm font-semibold text-stone-200">Files</h2>
          <span className="text-[13px] text-stone-500">
            {formatCount(job.totalFiles)} total
          </span>
        </div>
        <div className="divide-y divide-white/[0.04]">
          {visible.map((file) => (
            <MediaRow
              key={file.fileId ?? file.path}
              name={basename(file.path)}
              parent={parentFolder(file.path)}
              mediaType={file.mediaType}
              absPath={file.absPath}
              size={file.size}
              meta={fileMeta(file)}
              state={
                file.code === "already_uploaded"
                  ? { label: "Already in Google Photos", tone: "muted" }
                  : FILE_STATE[file.state]
              }
            />
          ))}
        </div>
        {remaining > 0 && (
          <div className="mt-3 flex justify-center">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setLimit((current) => current + 200)}
            >
              Show 200 more
            </Button>
          </div>
        )}
        {job.filesTruncated && (
          <p className="mt-3 text-[12px] leading-relaxed text-stone-600">
            Showing the first {formatCount(job.files.length)} of{" "}
            {formatCount(job.totalFiles)} files. Every file is still backed up;
            choose a narrower folder to inspect the rest.
          </p>
        )}
      </section>

      {(keys.length > 0 || rawErrors.length > 0 || job.lastError) && (
        <section className="mt-8 border-t border-white/[0.06] pt-2">
          <Disclosure title="Technical details">
            {job.lastError && (
              <p className="mb-3 text-[13px] leading-relaxed text-stone-500">
                {job.lastError}
              </p>
            )}
            {keys.length > 0 && (
              <div className="mb-4">
                <p className="text-[13px] font-medium text-stone-400">
                  Google Photos IDs
                </p>
                <ul className="mt-2 space-y-1.5">
                  {keys.map((file) => (
                    <li
                      key={file.fileId ?? file.path}
                      className="flex items-center gap-2 text-[12px]"
                    >
                      <span className="min-w-0 flex-1 truncate font-mono text-stone-500">
                        {basename(file.path)} · {file.remoteId}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          void copyKey(
                            file.fileId ?? file.path,
                            file.remoteId ?? "",
                          )
                        }
                        className="cursor-pointer rounded-md p-1 text-stone-600 transition hover:text-stone-300"
                        aria-label={`Copy Google Photos ID for ${basename(file.path)}`}
                      >
                        {copied === (file.fileId ?? file.path) ? (
                          <Check className="size-3 text-emerald-400" />
                        ) : (
                          <Copy className="size-3" />
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {rawErrors.length > 0 && (
              <div>
                <p className="text-[13px] font-medium text-stone-400">
                  Error codes
                </p>
                <ul className="mt-2 space-y-1 text-[12px] text-stone-500">
                  {rawErrors.map((file) => (
                    <li key={file.fileId ?? file.path}>
                      <span className="font-mono">{file.code}</span> ·{" "}
                      {basename(file.path)}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Disclosure>
        </section>
      )}

      <ConfirmDialog
        open={confirmUncertain}
        title="Some uploads are unconfirmed"
        body="Google may already have these files. Uploading them again can create duplicates. Continue only if you accept that risk."
        confirmLabel="Upload anyway"
        danger
        onConfirm={() => {
          setConfirmUncertain(false);
          onRetry(true);
        }}
        onCancel={() => setConfirmUncertain(false)}
      />
    </div>
  );
}
