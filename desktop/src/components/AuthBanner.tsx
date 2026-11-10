import { KeyRound, X } from "lucide-react";
import { Button } from "./ui";
import type { AuthNotice } from "../lib/authExpiry";

const COPY: Record<
  AuthNotice,
  { title: string; body: string; action: string }
> = {
  expired: {
    title: "Your Google Photos sign-in expired.",
    body: "It usually lasts about a day. Capture a new one from your phone to keep backing up.",
    action: "Reconnect",
  },
  needs_auth: {
    title: "Google Photos needs reconnecting.",
    body: "This backup can't continue with the current sign-in. Capture a new one from your phone, then resume it.",
    action: "Reconnect",
  },
  reconnected: {
    title: "Connection renewed.",
    body: "Google Photos is connected again. Open Activity to resume the backup that stopped.",
    action: "Open Activity",
  },
};

export function AuthBanner({
  notice,
  emailMasked,
  onAction,
  onDismiss,
}: {
  notice: AuthNotice;
  emailMasked?: string | null;
  onAction: () => void;
  onDismiss: () => void;
}) {
  const copy = COPY[notice];
  const reconnect = notice !== "reconnected";

  return (
    <div
      role="alert"
      className="border-b border-photon-400/25 bg-photon-400/[0.08] px-8 py-3"
    >
      <div className="mx-auto flex w-full max-w-4xl items-start gap-3">
        <KeyRound
          className="mt-0.5 size-4 shrink-0 text-photon-300"
          strokeWidth={1.7}
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-medium text-photon-200">
            {copy.title}
            {reconnect && emailMasked ? (
              <span className="font-normal text-photon-200/70">
                {" "}
                ({emailMasked})
              </span>
            ) : null}
          </p>
          <p className="mt-0.5 text-[13px] leading-relaxed text-photon-200/70">
            {copy.body}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button variant="primary" size="sm" onClick={onAction}>
            {copy.action}
          </Button>
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss for now"
            title="Dismiss for now"
            className="grid size-8 cursor-pointer place-items-center rounded-[8px] text-photon-200/60 transition hover:bg-white/[0.06] hover:text-photon-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-photon-400"
          >
            <X className="size-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
