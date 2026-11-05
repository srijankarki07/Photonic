const UNITS = ["B", "KB", "MB", "GB", "TB", "PB"] as const;

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "-";
  if (bytes === 0) return "0 B";
  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    UNITS.length - 1,
  );
  const value = bytes / 1024 ** exponent;
  const digits = value >= 100 || exponent === 0 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(digits)} ${UNITS[exponent]}`;
}

export function formatCount(value: number): string {
  return new Intl.NumberFormat().format(value);
}

/** Upload rate, e.g. `8.4 MB/s`. */
export function formatSpeed(bytesPerSecond: number | undefined): string {
  if (!bytesPerSecond || !Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) {
    return "-";
  }
  return `${formatBytes(bytesPerSecond)}/s`;
}

/** Show the person's home directory as `~` in every path we display. */
export function shortenPath(path: string): string {
  return path.replace(/^\/home\/[^/]+/, "~");
}

export function formatTime(epochSeconds: number): string {
  if (!Number.isFinite(epochSeconds) || epochSeconds <= 0) return "-";
  return new Date(epochSeconds * 1000).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}


export function basename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

export function parentFolder(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  parts.pop();
  return parts.join("/");
}

export function relativeTime(epochSeconds: number): string {
  if (!Number.isFinite(epochSeconds) || epochSeconds <= 0) return "";
  const seconds = Math.max(0, Date.now() / 1000 - epochSeconds);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 86400 * 7) return `${Math.floor(seconds / 86400)}d ago`;
  return formatTime(epochSeconds);
}
