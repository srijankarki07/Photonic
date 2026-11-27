import { ArrowRight, FolderOpen, Images, TriangleAlert } from "lucide-react";
import { MediaRow } from "../components/MediaRow";
import { Button, ErrorNotice } from "../components/ui";
import { SetupChecklist } from "../components/SetupChecklist";
import { StatusDot } from "../components/StatusDot";
import type { EngineError, JobSnapshot, ScanResult } from "../lib/engine/types";
import type { AuthState } from "../lib/engine/useAuth";
import {
  basename,
  formatBytes,
  formatCount,
  formatSpeed,
  parentFolder,
  shortenPath,
} from "../lib/format";
import { JOB_STATUS } from "../lib/jobLabels";
import { isAuthExpired } from "../lib/authExpiry";

export function Backup({
  scan,
  scanning,
  selectionLabel,
  engineError,
  auth,
  currentJob,
  recoveredCount,
  onChooseFolder,
  onChooseFiles,
  onReview,
  onConnect,
  onActivity,
  onTransparency,
  onRetryEngine,
}: {
  scan: ScanResult | null;
  scanning: boolean;
  selectionLabel: string;
  engineError: EngineError | null;
  auth: AuthState;
  currentJob: JobSnapshot | null;
  recoveredCount: number;
  onChooseFolder: () => void;
  onChooseFiles: () => void;
  onReview: () => void;
  onConnect: () => void;
  onActivity: () => void;
  onTransparency: () => void;
  onRetryEngine: () => void;
}) {
  const expired = isAuthExpired(auth.status);
  const connected = Boolean(auth.status?.connected) && !expired;
  const photos =
    scan?.files.filter((file) => file.mediaType === "image").length ?? 0;
  const videos =
    scan?.files.filter((file) => file.mediaType === "video").length ?? 0;
  const preview = scan?.files.slice(0, 8) ?? [];
  const jobActive = currentJob && currentJob.finishedAt === null;
  const jobStatus = currentJob ? JOB_STATUS[currentJob.status] : null;

  return (
    <div className="mx-auto w-full max-w-4xl px-8 py-9">
      {engineError && (
        <div className="mb-6">
          <ErrorNotice error={engineError} onRetry={onRetryEngine} />
        </div>
      )}

      {currentJob && (
        <button
          type="button"
          onClick={onActivity}
          className="surface-panel group mb-6 block w-full cursor-pointer rounded-[14px] px-5 py-4 text-left transition-[background-color,border-color] duration-150 hover:border-white/[0.13] hover:bg-ink-850/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-photon-400"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              {jobActive && (
                <span
                  aria-hidden="true"
                  className="size-2 shrink-0 animate-pulse rounded-full bg-photon-400"
                />
              )}
              <p className="text-[15px] font-semibold text-stone-100">
                {jobActive
                  ? "Backing up now"
                  : (jobStatus?.label ?? "Last backup")}
              </p>
            </div>
            <span className="flex items-center gap-1.5 text-[13px] font-medium text-stone-300 transition-colors group-hover:text-stone-100">
              View in Activity
              <ArrowRight className="size-3.5 text-stone-400 transition-transform duration-150 group-hover:translate-x-0.5" />
            </span>
          </div>
          <p className="mt-1.5 text-[13px] tabular-nums text-stone-400">
            {formatCount(currentJob.completedFiles)} of{" "}
            {formatCount(currentJob.totalFiles)} files
            {jobActive &&
              (currentJob.bytesPerSecond ?? 0) > 0 &&
              ` · ${formatSpeed(currentJob.bytesPerSecond)}`}
            {currentJob.failedFiles > 0 &&
              ` · ${formatCount(currentJob.failedFiles)} couldn't upload`}
            {currentJob.uncertainFiles > 0 &&
              ` · ${formatCount(currentJob.uncertainFiles)} need checking`}
          </p>
          <div
            className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/[0.08]"
            role="progressbar"
            aria-valuenow={Math.round(currentJob.percent)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Backup progress"
          >
            <div
              className="h-full rounded-full bg-photon-400 transition-[width] duration-500 ease-out"
              style={{ width: `${Math.max(2, currentJob.percent)}%` }}
            />
          </div>
        </button>
      )}

      {recoveredCount > 0 && (
        <button
          type="button"
          onClick={onActivity}
          className="mb-6 flex w-full cursor-pointer items-center gap-3 rounded-[14px] border border-photon-400/20 bg-photon-400/[0.07] px-4 py-3 text-left transition-colors duration-150 hover:border-photon-400/30 hover:bg-photon-400/[0.11] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-photon-400"
        >
          <TriangleAlert className="size-4 shrink-0 text-photon-300" />
          <p className="min-w-0 flex-1 text-sm text-stone-200">
            {recoveredCount} unfinished backup
            {recoveredCount === 1 ? "" : "s"} from a previous session.
          </p>
          <span className="text-[13px] font-medium text-photon-300">
            Open Activity
          </span>
        </button>
      )}

      {scanning && !scan && (
        <section>
          <h1 className="text-[32px] leading-tight text-stone-50">
            Looking through your folders…
          </h1>
          <p className="mt-2 text-[15px] text-stone-300">
            Nothing is uploading. We're counting photos and videos first.
          </p>
          <div className="mt-6 space-y-2">
            {Array.from({ length: 6 }).map((_, index) => (
              <div
                key={index}
                className="h-14 animate-pulse rounded-[10px] bg-white/[0.035]"
                style={{ animationDelay: `${index * 80}ms` }}
              />
            ))}
          </div>
        </section>
      )}

      {!scanning && scan && (
        <section>
          <h1 className="text-[32px] leading-tight text-stone-50">
            Ready to back up
          </h1>
          <p
            className="mt-1.5 truncate font-mono text-[13px] text-stone-400"
            title={selectionLabel}
          >
            {shortenPath(selectionLabel || scan.root)}
          </p>

          <p className="mt-4 text-[15px] tabular-nums text-stone-200">
            {formatCount(photos)} photos · {formatCount(videos)} videos ·{" "}
            {formatBytes(scan.totalBytes)} · {formatCount(scan.directoryCount)}{" "}
            folders
          </p>
          <p className="mt-1 text-[13px] text-stone-400">
            Includes subfolders. Nothing has uploaded yet.
            {scan.partial &&
              " We're showing the first batch; choose a narrower folder for the rest."}
            {scan.skippedCount > 0 &&
              ` ${formatCount(scan.skippedCount)} file${scan.skippedCount === 1 ? "" : "s"} won't be uploaded.`}
          </p>

          <div className="surface-panel mt-5 overflow-hidden rounded-[14px]">
            <div className="divide-y divide-white/[0.05]">
              {preview.map((file) => (
                <div key={file.absPath} className="px-2.5">
                  <MediaRow
                    name={basename(file.path)}
                    parent={shortenPath(parentFolder(file.path))}
                    mediaType={file.mediaType}
                    absPath={file.absPath}
                    size={file.size}
                  />
                </div>
              ))}
            </div>
            {scan.files.length > preview.length && (
              <p className="border-t border-white/[0.06] px-4 py-2.5 text-[13px] tabular-nums text-stone-400">
                and {formatCount(scan.files.length - preview.length)} more
              </p>
            )}
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-2.5">
            <Button variant="primary" onClick={onReview}>
              Review {formatCount(scan.mediaCount)} items
              <ArrowRight className="size-4" />
            </Button>
            <Button variant="secondary" onClick={onChooseFolder}>
              <FolderOpen className="size-4" />
              Choose different folders
            </Button>
            <Button variant="ghost" onClick={onChooseFiles}>
              <Images className="size-4" />
              Add photos
            </Button>
          </div>
        </section>
      )}

      {!scanning && !scan && (
        <section className="surface-panel rounded-[18px] p-7 sm:p-9">
          <div className="flex flex-col items-start">
            <h1 className="text-[34px] leading-[1.1] text-stone-50">
              Back up your photos.
            </h1>
            <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-stone-300">
              Choose folders or individual photos, or drop them anywhere in this
              window. We'll show you exactly what will upload before anything
              leaves this computer.
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-2.5">
              <Button variant="primary" onClick={onChooseFolder}>
                <FolderOpen className="size-4" />
                Choose folders
              </Button>
              <Button variant="secondary" onClick={onChooseFiles}>
                <Images className="size-4" />
                Choose photos
              </Button>
            </div>
            <p className="mt-6 border-t border-white/[0.06] pt-4 text-[13px] leading-relaxed text-stone-400">
              Your photos go directly from this computer to Google Photos. No
              Photonic account, server, or telemetry.{" "}
              <button
                type="button"
                onClick={onTransparency}
                className="cursor-pointer rounded-[4px] text-stone-200 underline decoration-stone-500 underline-offset-3 transition hover:text-stone-50 hover:decoration-stone-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-photon-400"
              >
                How Photonic works
              </button>
            </p>
          </div>
        </section>
      )}

      {(!connected || !scan) && !scanning && (
        <section className="surface-panel mt-7 rounded-[16px] px-5 py-4">
          <h2 className="text-[14px] font-semibold text-stone-100">
            Finish setting up
          </h2>
          <div className="mt-1">
            <SetupChecklist
              steps={[
                {
                  title: "Connect Google Photos",
                  detail: connected
                    ? "Your phone is connected."
                    : expired
                      ? "The sign-in expired. Reconnect from your phone."
                      : "You'll need the ReVanced Photos app on an Android phone.",
                  state: connected ? "done" : "next",
                  action: connected ? (
                    <StatusDot tone="good" label="Connected" />
                  ) : (
                    <Button variant="secondary" size="sm" onClick={onConnect}>
                      Connect
                    </Button>
                  ),
                },
                {
                  title: "Choose what to back up",
                  detail: scan
                    ? `${formatCount(scan.mediaCount)} items ready for review.`
                    : "Pick folders or photos; nothing uploads until you review.",
                  state: scan ? "done" : connected ? "next" : "todo",
                  action: !scan ? (
                    <Button variant="ghost" size="sm" onClick={onChooseFolder}>
                      Choose
                      <ArrowRight className="size-3.5" />
                    </Button>
                  ) : undefined,
                },
              ]}
            />
          </div>
        </section>
      )}
    </div>
  );
}
