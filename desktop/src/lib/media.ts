import { convertFileSrc } from "@tauri-apps/api/core";

/** A webview URL for a local media file, or null outside Tauri / if unavailable. */
export function mediaUrl(absPath: string | null | undefined): string | null {
  if (!absPath) return null;
  try {
    if (
      typeof window === "undefined" ||
      !("__TAURI_INTERNALS__" in window)
    ) {
      return null;
    }
    return convertFileSrc(absPath);
  } catch {
    return null;
  }
}
