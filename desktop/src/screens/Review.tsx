import { useDeferredValue, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  FolderOpen,
  Images,
  LayoutGrid,
  List,
  Search,
} from "lucide-react";
import { Button, ErrorNotice } from "../components/ui";
import { cn } from "../lib/cn";
import { Disclosure } from "../components/Disclosure";
import { MediaGrid } from "../components/MediaGrid";
import { MediaRow } from "../components/MediaRow";
import { StatusDot } from "../components/StatusDot";
import type { EngineError, ScanResult } from "../lib/engine/types";
import type { AuthState } from "../lib/engine/useAuth";
import {
  basename,
  formatBytes,
  formatCount,
  parentFolder,
  shortenPath,
} from "../lib/format";
import { skipReason } from "../lib/messages";
import { isAuthExpired } from "../lib/authExpiry";

type AlbumPolicy = "timeline" | "per_job" | "per_folder";

const ALBUM_OPTIONS: Array<{
  id: AlbumPolicy;
  title: string;
  detail: string;
}> = [
  {
    id: "timeline",
    title: "Timeline",
    detail: "No album. Items appear in your normal library.",
  },
  {
    id: "per_job",
    title: "One album for this backup",
    detail: "Everything goes into one album named after the folder.",
  },
  {
    id: "per_folder",
    title: "One album per folder",
    detail: "Each immediate parent folder becomes an album.",
  },
];

export function Review({
  selection,
  selectionLabel,
  scan,
  scanning,
  error,
  auth,
  uploading,
  onChooseFolder,
  onChooseFiles,
  onRetry,
  onBack,
  onConnect,
  onUpload,
}: {
  selection: string[];
  selectionLabel: string;
  scan: ScanResult | null;
  scanning: boolean;
  error: EngineError | null;
  auth: AuthState;
  uploading: boolean;
  onChooseFolder: () => void;
  onChooseFiles: () => void;
  onRetry: () => void;
  onBack: () => void;
  onConnect: () => void;
  onUpload: (policy: AlbumPolicy, albumName: string | null) => Promise<boolean>;
}) {
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [limit, setLimit] = useState(200);
  const [view, setView] = useState<"grid" | "list">("grid");
  const [albumPolicy, setAlbumPolicy] = useState<AlbumPolicy>("timeline");
  const [albumName, setAlbumName] = useState("");
  const expired = isAuthExpired(auth.status);
  const connected = Boolean(auth.status?.connected) && !expired;
  const defaultAlbumName =
    selection.length === 1
      ? (selection[0].split("/").filter(Boolean).pop() ?? "")
      : "Photonic selection";

  useEffect(() => {
    setLimit(200);
  }, [deferredQuery]);

  const filtered = useMemo(() => {
    const files = scan?.files ?? [];
    const needle = deferredQuery.trim().toLowerCase();
    if (!needle) return files;
    return files.filter((file) => file.path.toLowerCase().includes(needle));
  }, [scan, deferredQuery]);

  const visible = filtered.slice(0, limit);
  const remaining = filtered.length - visible.length;
  const photos =
    scan?.files.filter((file) => file.mediaType === "image").length ?? 0;
  const videos =
    scan?.files.filter((file) => file.mediaType === "video").length ?? 0;
  const warningCount = (scan?.skippedCount ?? 0) + (scan?.warnings.length ?? 0);

  return (
    <div className="mx-auto w-full max-w-4xl px-8 py-8">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex cursor-pointer items-center gap-1.5 rounded-[6px] text-[13px] font-medium text-stone-400 transition hover:text-stone-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-photon-400"
      >
        <ArrowLeft className="size-3.5" />
        Back
      </button>

      <div className="mt-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[34px] leading-tight text-stone-50">Review</h1>
          <p
            className="mt-1.5 truncate font-mono text-[13px] text-stone-400"
            title={selectionLabel}
          >
            {shortenPath(selectionLabel)}
          </p>
        </div>
        <StatusDot
          tone={expired ? "warn" : connected ? "good" : "muted"}
          label={
            expired
              ? "Sign-in expired"
              : connected
                ? "Ready to upload"
                : "Connect to upload"
          }
        />
      </div>

      {scanning && (
        <section className="mt-8">
          <h2 className="text-sm font-medium text-stone-200">
            Looking through your folders…
          </h2>
          <p className="mt-1 text-[13px] text-stone-400">
            Nothing is uploading. We're counting photos and videos first.
          </p>
          <div className="mt-5 grid grid-cols-4 gap-2">
            {Array.from({ length: 8 }).map((_, index) => (
              <div
                key={index}
                className="aspect-square animate-pulse rounded-[10px] bg-white/[0.04]"
                style={{ animationDelay: `${index * 70}ms` }}
              />
            ))}
          </div>
          <div className="mt-4 space-y-2">
            {Array.from({ length: 5 }).map((_, index) => (
              <div
                key={index}
                className="h-12 animate-pulse rounded-[10px] bg-white/[0.03]"
                style={{ animationDelay: `${index * 80}ms` }}
              />
            ))}
          </div>
        </section>
      )}

      {!scanning && error && (
        <div className="mt-8 space-y-3">
          <ErrorNotice error={error} onRetry={onRetry} retryLabel="Scan again" />
          <Button variant="secondary" onClick={onChooseFolder}>
            <FolderOpen className="size-4" />
            Choose another folder
          </Button>
        </div>
      )}

      {!scanning && !error && scan && (
        <>
          <div className="surface-panel mt-6 rounded-[14px] px-5 py-4">
            <p className="text-[15px] font-medium tabular-nums text-stone-100">
              {formatCount(photos)} photos · {formatCount(videos)} videos ·{" "}
              {formatBytes(scan.totalBytes)} · {formatCount(scan.directoryCount)}{" "}
              folders
            </p>
            <p className="mt-1 text-[13px] text-stone-400">
              Includes subfolders. Nothing has uploaded yet.
              {scan.partial &&
                " This is the first batch; choose a narrower folder for the rest."}
            </p>
          </div>

          {warningCount > 0 && (
            <div className="mt-4 rounded-[14px] border border-white/[0.08] bg-white/[0.025] px-4 py-1">
              <Disclosure
                title={`${formatCount(warningCount)} file${warningCount === 1 ? "" : "s"} won't be uploaded or need attention`}
              >
                <ul className="max-h-48 space-y-1.5 overflow-y-auto py-1">
                  {scan.skipped.slice(0, 50).map((item) => (
                    <li
                      key={item.path}
                      className="flex items-center justify-between gap-3 text-[12px]"
                    >
                      <span
                        className="truncate font-mono text-stone-300"
                        title={item.path}
                      >
                        {shortenPath(item.path)}
                      </span>
                      <span className="shrink-0 text-stone-400">
                        {skipReason(item.reason)}
                      </span>
                    </li>
                  ))}
                  {scan.warnings.slice(0, 20).map((item, index) => (
                    <li
                      key={`${item.path}-${index}`}
                      className="flex items-center justify-between gap-3 text-[12px]"
                    >
                      <span
                        className="truncate font-mono text-stone-300"
                        title={item.path}
                      >
                        {shortenPath(item.path)}
                      </span>
                      <span className="shrink-0 text-stone-400">
                        {skipReason(item.reason)}
                      </span>
                    </li>
                  ))}
                </ul>
              </Disclosure>
            </div>
          )}

          <section className="mt-7">
            <h2 className="text-[14px] font-semibold text-stone-100">
              Where should these go?
            </h2>
            <div className="mt-2.5 space-y-2">
              {ALBUM_OPTIONS.map((option) => {
                const selected = albumPolicy === option.id;
                return (
                  <label
                    key={option.id}
                    className={cn(
                      "flex cursor-pointer items-start gap-3.5 rounded-[12px] border px-4 py-3.5 transition-colors duration-150 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-photon-400",
                      selected
                        ? "border-photon-400/35 bg-photon-400/[0.07]"
                        : "border-white/[0.07] bg-ink-900/55 hover:border-white/[0.13] hover:bg-ink-850/70",
                    )}
                  >
                    <input
                      type="radio"
                      name="album-policy"
                      value={option.id}
                      checked={selected}
                      onChange={() => {
                        setAlbumPolicy(option.id);
                        if (option.id === "per_job" && !albumName) {
                          setAlbumName(defaultAlbumName);
                        }
                      }}
                      className="mt-0.5 size-4 accent-photon-400"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-stone-100">
                        {option.title}
                      </span>
                      <span className="mt-0.5 block text-[13px] leading-relaxed text-stone-400">
                        {option.detail}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
            {albumPolicy === "per_job" && (
              <div className="mt-3">
                <label
                  htmlFor="album-name"
                  className="text-[13px] font-medium text-stone-300"
                >
                  Album name
                </label>
                <input
                  id="album-name"
                  value={albumName}
                  onChange={(event) => setAlbumName(event.currentTarget.value)}
                  placeholder={defaultAlbumName || "Vacation 2026"}
                  maxLength={120}
                  className="mt-1.5 w-full rounded-[10px] border border-white/[0.1] bg-ink-900 px-3.5 py-2.5 text-sm text-stone-100 outline-none placeholder:text-stone-500 focus:border-photon-400/50 focus:ring-2 focus:ring-photon-400/20"
                />
              </div>
            )}
          </section>

          <section className="mt-8">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.07] pb-3.5">
              <div className="flex items-center gap-2">
                <h2 className="text-[14px] font-semibold text-stone-100">
                  Files
                </h2>
                <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[12px] tabular-nums text-stone-300">
                  {formatCount(scan.mediaCount)}
                </span>
              </div>
              <div className="flex w-full items-center gap-2 sm:w-auto">
                <label className="flex min-w-0 flex-1 items-center gap-2 rounded-[10px] border border-white/[0.08] bg-ink-900 px-3 py-1.5 transition-colors focus-within:border-photon-400/45 focus-within:ring-2 focus-within:ring-photon-400/15 sm:w-56 sm:flex-none">
                  <Search className="size-3.5 shrink-0 text-stone-400" />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.currentTarget.value)}
                    placeholder="Search files"
                    className="w-full bg-transparent text-[13px] text-stone-100 outline-none placeholder:text-stone-500"
                    aria-label="Search files"
                  />
                </label>
                <div
                  role="group"
                  aria-label="File view"
                  className="flex shrink-0 items-center gap-0.5 rounded-[10px] border border-white/[0.08] bg-ink-900 p-0.5"
                >
                  <button
                    type="button"
                    onClick={() => setView("grid")}
                    aria-pressed={view === "grid"}
                    aria-label="Grid view"
                    title="Grid view"
                    className={cn(
                      "grid size-8 place-items-center rounded-[8px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-photon-400",
                      view === "grid"
                        ? "bg-ink-700 text-stone-50 ring-1 ring-white/[0.08]"
                        : "text-stone-400 hover:text-stone-200",
                    )}
                  >
                    <LayoutGrid className="size-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setView("list")}
                    aria-pressed={view === "list"}
                    aria-label="List view"
                    title="List view"
                    className={cn(
                      "grid size-8 place-items-center rounded-[8px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-photon-400",
                      view === "list"
                        ? "bg-ink-700 text-stone-50 ring-1 ring-white/[0.08]"
                        : "text-stone-400 hover:text-stone-200",
                    )}
                  >
                    <List className="size-4" />
                  </button>
                </div>
              </div>
            </div>

            {view === "grid" ? (
              <MediaGrid
                className="mt-4"
                items={visible.map((file) => ({
                  absPath: file.absPath,
                  mediaType: file.mediaType,
                  name: basename(file.path),
                  size: file.size,
                }))}
              />
            ) : (
              <div className="mt-2 divide-y divide-white/[0.05]">
                {visible.map((file) => (
                  <MediaRow
                    key={file.absPath}
                    name={basename(file.path)}
                    parent={parentFolder(file.path)}
                    mediaType={file.mediaType}
                    absPath={file.absPath}
                    size={file.size}
                  />
                ))}
              </div>
            )}

            {visible.length === 0 && (
              <p className="py-10 text-center text-sm text-stone-400">
                No files match “{query}”.
              </p>
            )}
            <div className="mt-4 flex items-center justify-between">
              <span className="text-[12px] tabular-nums text-stone-400">
                Showing {formatCount(visible.length)} of{" "}
                {formatCount(filtered.length)}
              </span>
              {remaining > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setLimit((current) => current + 200)}
                >
                  Show 200 more
                </Button>
              )}
            </div>
          </section>

          <div className="sticky bottom-0 z-10 -mx-8 mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.08] bg-ink-950/92 px-8 py-4 shadow-[0_-12px_32px_-16px_rgba(0,0,0,0.85)] backdrop-blur-md">
            <div>
              <p className="text-sm font-semibold tabular-nums text-stone-100">
                {formatCount(scan.mediaCount)} items ready
              </p>
              <p className="mt-0.5 text-[13px] text-stone-400">
                {connected
                  ? "We'll back these up in the background."
                  : "Connect Google Photos to start the backup."}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={onChooseFiles}
                disabled={uploading}
              >
                <Images className="size-3.5" />
                Add photos
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={onChooseFolder}
                disabled={uploading}
              >
                <FolderOpen className="size-3.5" />
                Different folders
              </Button>
              {connected ? (
                <Button
                  variant="primary"
                  onClick={() =>
                    void onUpload(albumPolicy, albumName.trim() || null)
                  }
                  loading={uploading}
                  disabled={scan.mediaCount === 0}
                >
                  Upload {formatCount(scan.mediaCount)} items
                </Button>
              ) : (
                <Button variant="primary" onClick={onConnect}>
                  Connect to upload
                </Button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
