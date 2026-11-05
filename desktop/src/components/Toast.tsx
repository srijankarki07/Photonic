import { useEffect } from "react";
import { X } from "lucide-react";
import { cn } from "../lib/cn";

export type ToastTone = "info" | "success" | "danger";

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
    const timeout = window.setTimeout(onDismiss, tone === "danger" ? 9000 : 6000);
    return () => window.clearTimeout(timeout);
  }, [message, tone, onDismiss]);

  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cn(
        "fixed bottom-6 left-1/2 z-50 flex max-w-md -translate-x-1/2 items-center gap-3 rounded-[12px] border px-4 py-3 text-sm shadow-[0_18px_50px_-18px_rgba(0,0,0,0.9)]",
        tone === "danger"
          ? "border-red-400/25 bg-ink-800 text-red-200"
          : tone === "success"
            ? "border-emerald-400/20 bg-ink-800 text-emerald-200"
            : "border-white/10 bg-ink-800 text-stone-200",
      )}
    >
      <span className="min-w-0 flex-1 leading-relaxed">{message}</span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss message"
        className="cursor-pointer rounded-md p-1 text-stone-500 transition hover:text-stone-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-photon-400"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}
