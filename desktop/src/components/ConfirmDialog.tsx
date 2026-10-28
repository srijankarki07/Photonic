import { useEffect, useRef } from "react";
import { cn } from "../lib/cn";
import { Button } from "./ui";

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel = "Continue",
  cancelLabel = "Cancel",
  danger = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  body: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) return;
    previousFocus.current = document.activeElement;
    confirmRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => !element.hasAttribute("disabled"));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      const previous = previousFocus.current;
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-6 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        className="w-full max-w-md rounded-[18px] border border-white/10 bg-ink-850 p-6 shadow-[0_24px_80px_-24px_rgba(0,0,0,0.9)]"
      >
        <h2
          id="confirm-title"
          className="text-lg font-medium text-stone-100"
        >
          {title}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-stone-400">{body}</p>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            className={cn(
              "cursor-pointer rounded-[10px] px-3.5 py-2 text-sm font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-photon-300",
              danger
                ? "bg-red-400/15 text-red-200 hover:bg-red-400/25"
                : "bg-photon-400 text-ink-950 hover:bg-photon-300",
            )}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
