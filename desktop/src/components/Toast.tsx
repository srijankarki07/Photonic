import { useEffect } from "react";
import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import { cn } from "../lib/cn";

export type ToastTone = "info" | "success" | "danger";

const TONE_ICON = {
  info: Info,
  success: CheckCircle2,
  danger: AlertTriangle,
} as const;

export function Toast({
  message,
  tone = "info",
  onDismiss,
}: {
  message: string;
  tone?: ToastTone;
  onDismiss: () => void;
}) {
  useEffect(() => {
    const timeout = window.setTimeout(
      onDismiss,
      tone === "danger" ? 9000 : 6000,
    );
    return () => window.clearTimeout(timeout);
  }, [message, tone, onDismiss]);

  const Icon = TONE_ICON[tone];

  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cn(
        "animate-toast-in fixed bottom-6 left-1/2 z-50 flex max-w-md -translate-x-1/2 items-center gap-3 rounded-[12px] border px-4 py-3 text-sm shadow-[0_18px_50px_-14px_rgba(0,0,0,0.92)]",
        tone === "danger"
          ? "border-red-400/30 bg-ink-800 text-red-100"
          : tone === "success"
            ? "border-emerald-400/25 bg-ink-800 text-emerald-100"
            : "border-white/[0.12] bg-ink-800 text-stone-100",
      )}
    >
      <Icon
        className={cn(
          "size-4 shrink-0",
          tone === "danger"
            ? "text-red-300"
            : tone === "success"
              ? "text-emerald-300"
              : "text-photon-300",
        )}
        strokeWidth={1.8}
        aria-hidden="true"
      />
      <span className="min-w-0 flex-1 leading-relaxed">{message}</span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss message"
        className="cursor-pointer rounded-md p-1 text-stone-400 transition hover:bg-white/[0.06] hover:text-stone-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-photon-400"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}
