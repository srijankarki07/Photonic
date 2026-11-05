import type { EngineError } from "./engine/types";

export interface FriendlyMessage {
  title: string;
  body: string;
  action?: string;
}

const ERROR_COPY: Record<string, FriendlyMessage> = {
  auth_missing: {
    title: "Connect Google Photos",
    body: "Photonic needs a one-time sign-in key from your phone before it can back anything up.",
    action: "Connect",
  },
  auth_expired: {
    title: "Your connection expired",
    body: "Google no longer accepts the saved sign-in. It usually lasts about a day. Reconnect to continue.",
    action: "Reconnect",
  },
  auth_invalid: {
    title: "That sign-in didn't work",
    body: "The saved sign-in is incomplete or damaged. Capture a fresh one from your phone.",
    action: "Reconnect",
  },
  auth_scope: {
    title: "Google didn't allow photo access",
    body: "The saved sign-in can't add photos. Reconnect Google Photos, then retry the files that didn't upload.",
    action: "Reconnect",
  },
  upload_forbidden: {
    title: "Google refused this upload",
    body: "Reconnect, then retry. If it keeps happening, wait a few hours or try again with a different account.",
    action: "Reconnect",
  },
  rate_limited: {
    title: "Google is limiting this account for now",
    body: "Wait a few hours before trying again. Repeated attempts can make the limit worse.",
    action: "Try later",
  },
  network: {
    title: "The connection was interrupted",
    body: "Check your internet connection, then retry the files that didn't finish.",
    action: "Retry",
  },
  file_missing: {
    title: "A file disappeared",
    body: "It was moved or deleted before it could be uploaded. The rest of the backup is unaffected.",
    action: "Skip",
  },
  file_unreadable: {
    title: "This file can't be read",
    body: "Check its permissions, or remove it from the backup and try again.",
  },
  unsupported_mime: {
    title: "This file type isn't supported",
    body: "Google Photos skipped it. The rest of the backup can continue.",
  },
  mime_mismatch: {
    title: "The file doesn't match its name",
    body: "Its contents look like a different file type. Rename it to its real extension or remove it.",
  },
  file_empty: {
    title: "This file is empty",
    body: "Zero-byte files are skipped.",
  },
  file_unstable: {
    title: "This file is still being copied",
    body: "Wait for the copy to finish, then retry that file.",
    action: "Retry",
  },
  uncertain: {
    title: "We couldn't confirm this upload",
    body: "Google may already have this file. Retrying could create a duplicate, so check before you retry.",
    action: "Review",
  },
  ledger_uncertain: {
    title: "A previous attempt is unconfirmed",
    body: "This file may already be in Google Photos. Check before uploading it again.",
    action: "Review",
  },
  already_uploaded: {
    title: "Already backed up",
    body: "Photonic found this file in its upload history and skipped it.",
  },
  keyring_locked: {
    title: "Your password manager is locked",
    body: "Unlock GNOME Keyring or KWallet, then try again.",
    action: "Try again",
  },
  keyring_unavailable: {
    title: "No password manager is available",
    body: "Photonic keeps the sign-in key in your desktop's password manager. Sign in to a desktop session, then retry.",
  },
  adb_missing: {
    title: "Phone tools aren't installed",
    body: "Photonic can't see Android phones yet. Install android-tools-adb and try again.",
    action: "Show instructions",
  },
  device_not_found: {
    title: "Phone not found",
    body: "Connect it with a USB cable, unlock it, and accept the USB prompt.",
    action: "Try again",
  },
  capture_timeout: {
    title: "No sign-in appeared",
    body: "Open the Photos account screen on your phone while Photonic is listening.",
    action: "Try again",
  },
  capture_failed: {
    title: "We didn't see a sign-in",
    body: "Open the Photos account screen on your phone, then try again.",
    action: "Try again",
  },
  auth_incomplete: {
    title: "The sign-in was incomplete",
    body: "Sign in again on the phone and keep the Photos account screen open until it finishes.",
    action: "Try again",
  },
  job_busy: {
    title: "This backup is still running",
    body: "Wait for it to finish before retrying or resuming.",
  },
  no_failed_files: {
    title: "Nothing needs retrying",
    body: "There are no failed files. Files that need checking must be reviewed separately.",
  },
  no_work: {
    title: "Nothing left to resume",
    body: "This backup has no pending files. Check any files that need confirmation.",
  },
  no_media: {
    title: "No photos or videos found",
    body: "Choose a folder that contains images or videos.",
  },
  not_a_directory: {
    title: "That's not a folder",
    body: "Select a folder, or choose individual photos instead.",
  },
  not_found: {
    title: "We couldn't find that",
    body: "The folder may have moved. Choose it again.",
  },
  permission_denied: {
    title: "This folder isn't accessible",
    body: "Check its permissions, or choose another folder.",
  },
  gpmc_missing: {
    title: "The upload tool is missing",
    body: "Photonic can't upload yet. Check Settings → Advanced for details.",
  },
  upload_failed: {
    title: "This file didn't upload",
    body: "Retry it. If it keeps failing, open Advanced details to see more.",
    action: "Retry",
  },
};

export function humanizeError(error: EngineError): FriendlyMessage {
  const known = ERROR_COPY[error.code];
  if (known) return known;
  return {
    title: "Something went wrong",
    body: error.message || error.hint || "Try again in a moment.",
  };
}

const SKIP_COPY: Record<string, string> = {
  unsupported: "Not a photo or video",
  empty: "Empty file",
  file_empty: "Empty file",
  mime_mismatch: "Contents don't match the file name",
  unsupported_mime: "Unsupported file type",
  file_unstable: "Still being copied",
  already_uploaded: "Already backed up",
  ledger_uncertain: "Previous attempt needs checking",
  symlink_skipped: "Shortcut skipped",
  permission_denied: "Permission denied",
  selection_missing: "Selection no longer exists",
  duplicate_selection: "Selected twice - counted once",
  not_a_file: "Not a regular file",
  file_missing: "File disappeared",
  file_unreadable: "Can't read this file",
};

export function skipReason(reason: string): string {
  const known = SKIP_COPY[reason];
  if (known) return known;
  return reason.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}
