import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import type { EngineInfo } from "../lib/engine/types";
import { TransparencyContent } from "./TransparencyContent";

export function TransparencyDialog({
  open,
  onClose,
  info,
}: {
  open: boolean;
  onClose: () => void;
  info?: EngineInfo | null;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/65 p-6 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="transparency-title"
        className="flex max-h-[82vh] w-full max-w-2xl flex-col overflow-hidden rounded-[18px] border border-white/10 bg-ink-850 shadow-[0_24px_90px_-24px_rgba(0,0,0,0.95)]"
      >
        <div className="flex items-center justify-between border-b border-white/[0.06] px-6 py-4">
          <h2
            id="transparency-title"
            className="font-display text-[22px] text-stone-100"
          >
            How Photonic works
          </h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="cursor-pointer rounded-lg p-1.5 text-stone-500 transition hover:bg-white/[0.05] hover:text-stone-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-photon-400"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="overflow-y-auto px-6 py-5">
          <TransparencyContent info={info} />
        </div>
      </div>
    </div>
  );
}
