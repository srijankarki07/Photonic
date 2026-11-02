import { open } from "@tauri-apps/plugin-dialog";

const MEDIA_EXTENSIONS = [
  "jpg",
  "jpeg",
  "png",
  "gif",
  "webp",
  "heic",
  "heif",
  "avif",
  "bmp",
  "tif",
  "tiff",
  "dng",
  "raw",
  "cr2",
  "cr3",
  "nef",
  "arw",
  "raf",
  "orf",
  "rw2",
  "jxl",
  "mp4",
  "mov",
  "m4v",
  "mkv",
  "avi",
  "wmv",
  "mpg",
  "mpeg",
  "3gp",
  "3g2",
  "mts",
  "m2ts",
  "ts",
  "webm",
  "vob",
  "flv",
];

/** Native single-folder chooser. Returns null when cancelled. */
export async function pickFolder(): Promise<string | null> {
  const selected = await open({
    directory: true,
    multiple: false,
    title: "Choose a folder to back up",
  });
  return typeof selected === "string" ? selected : null;
}

/** Native multi-folder chooser. */
export async function pickFolders(): Promise<string[] | null> {
  const selected = await open({
    directory: true,
    multiple: true,
    title: "Choose folders to back up",
  });
  if (!selected) return null;
  return Array.isArray(selected) ? selected : [selected];
}

/** Native multi-file chooser for photos and videos. */
export async function pickFiles(): Promise<string[] | null> {
  const selected = await open({
    directory: false,
    multiple: true,
    title: "Choose photos and videos",
    filters: [{ name: "Photos and videos", extensions: MEDIA_EXTENSIONS }],
  });
  if (!selected) return null;
  return Array.isArray(selected) ? selected : [selected];
}
