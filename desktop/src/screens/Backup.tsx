import { ArrowRight, FolderOpen, Images, TriangleAlert } from "lucide-react";
import { BrandMark } from "../components/BrandMark";
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
    <div className="mx-auto w-full max-w-4xl px-8 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 text-photon-400">
          <BrandMark className="size-6" />
          <span className="text-[13px] font-medium uppercase tracking-[0.14em] text-stone-500">
            Back up
          </span>
        </div>
        <StatusDot
          tone={expired ? "warn" : connected ? "good" : "muted"}
          label={
            expired
              ? "Google Photos sign-in expired"
              : connected
                ? `Connected${auth.status?.emailMasked ? ` as ${auth.status.emailMasked}` : ""}`
                : "Photos not connected"
          }
        />
      </div>

      {engineError && (
        <div className="mt-6">
          <ErrorNotice error={engineError} onRetry={onRetryEngine} />
        </div>
      )}

      {currentJob && (
        <button
          type="button"
          onClick={onActivity}
          className="mt-6 block w-full cursor-pointer rounded-[14px] border border-white/[0.07] bg-white/[0.025] px-4 py-3.5 text-left transition hover:bg-white/[0.045] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-photon-400"
        >
          <div className="flex items-center justify-between gap-3">
            <p className="text-base font-medium text-stone-100">
              {jobActive ? "Backing up now" : (jobStatus?.label ?? "Last backup")}
            </p>
            <span className="flex items-center gap-1.5 text-sm text-stone-400">
              View in Activity
              <ArrowRight className="size-4 text-stone-600" />
            </span>
          </div>
          <p className="mt-1 text-sm text-stone-400">
            {formatCount(currentJob.completedFiles)} of{" "}
            {formatCount(currentJob.totalFiles)} files
            {jobActive && (currentJob.bytesPerSecond ?? 0) > 0 &&
              ` · ${formatSpeed(currentJob.bytesPerSecond)}`}
            {currentJob.failedFiles > 0 &&
              ` · ${formatCount(currentJob.failedFiles)} couldn't upload`}
            {currentJob.uncertainFiles > 0 &&
              ` · ${formatCount(currentJob.uncertainFiles)} need checking`}
          </p>
          <div
            className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/[0.07]"
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
          className="mt-4 flex w-full cursor-pointer items-center gap-3 rounded-[14px] bg-photon-400/[0.06] px-4 py-3 text-left transition hover:bg-photon-400/[0.09] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-photon-400"
        >
          <TriangleAlert className="size-4 shrink-0 text-photon-300" />
          <p className="min-w-0 flex-1 text-sm text-stone-300">
            {recoveredCount} unfinished backup
            {recoveredCount === 1 ? "" : "s"} from a previous session.
          </p>
          <span className="text-sm text-stone-500">Open Activity</span>
        </button>
      )}

      {scanning && !scan && (
        <section className="mt-8">
          <h1 className="font-display text-[32px] leading-tight text-stone-50">
            Looking through your folders…
          </h1>
          <p className="mt-2 text-[15px] text-stone-400">
            Nothing is uploading. We're counting photos and videos first.
          </p>
          <div className="mt-6 space-y-2">
            {Array.from({ length: 6 }).map((_, index) => (
              <div
                key={index}
                className="h-14 animate-pulse rounded-[10px] bg-white/[0.025]"
                style={{ animationDelay: `${index * 80}ms` }}
              />
            ))}
          </div>
        </section>
      )}

      {!scanning && scan && (
        <section className="mt-8">
          <h1 className="font-display text-[32px] leading-tight text-stone-50">
            Ready to back up
          </h1>
          <p
            className="mt-2 truncate text-[13px] text-stone-500"
            title={selectionLabel}
          >
            {shortenPath(selectionLabel || scan.root)}
          </p>

          <p className="mt-3 text-[15px] text-stone-300">
            {formatCount(photos)} photos · {formatCount(videos)} videos ·{" "}
            {formatBytes(scan.totalBytes)} · {formatCount(scan.directoryCount)}{" "}
            folders
          </p>
          <p className="mt-1 text-[13px] text-stone-500">
            Includes subfolders. Nothing has uploaded yet.
            {scan.partial &&
              " We're showing the first batch; choose a narrower folder for the rest."}
            {scan.skippedCount > 0 &&
              ` ${formatCount(scan.skippedCount)} file${scan.skippedCount === 1 ? "" : "s"} won't be uploaded.`}
          </p>

          <div className="mt-5 overflow-hidden rounded-[14px] border border-white/[0.06]">
            <div className="divide-y divide-white/[0.045]">
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
              <p className="border-t border-white/[0.06] px-4 py-2.5 text-[13px] text-stone-500">
                and {formatCount(scan.files.length - preview.length)} more
              </p>
            )}
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-2">
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
        <section className="mt-10">
          <div className="flex flex-col items-start">
            <BrandMark className="size-11 text-photon-400" />
            <h1 className="mt-5 font-display text-[34px] leading-[1.1] text-stone-50">
              Back up your photos.
            </h1>
            <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-stone-300">
              Choose folders or individual photos. We'll show you exactly what
              will upload before anything leaves this computer.
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              <Button variant="primary" onClick={onChooseFolder}>
                <FolderOpen className="size-4" />
                Choose folders
              </Button>
              <Button variant="secondary" onClick={onChooseFiles}>
                <Images className="size-4" />
                Choose photos
              </Button>
            </div>
            <p className="mt-4 max-w-xl text-[13px] leading-relaxed text-stone-500">
              Your photos go directly from this computer to Google Photos. No
              Photonic account, server, or telemetry.{" "}
              <button
                type="button"
                onClick={onTransparency}
                className="cursor-pointer text-stone-400 underline decoration-stone-700 underline-offset-2 transition hover:text-stone-200"
              >
                How Photonic works
              </button>
            </p>
          </div>
        </section>
      )}

      {(!connected || !scan) && !scanning && (
        <section className="mt-10 border-t border-white/[0.06] pt-6">
          <h2 className="text-[15px] font-semibold text-stone-200">
            Finish setting up
          </h2>
          <div className="mt-2">
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
