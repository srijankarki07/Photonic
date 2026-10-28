import { useRef } from "react";
import { cn } from "../lib/cn";

export interface TabItem {
  id: string;
  label: string;
  count?: number;
}

export function SegmentedTabs({
  tabs,
  active,
  onChange,
  className,
}: {
  tabs: TabItem[];
  active: string;
  onChange: (id: string) => void;
  className?: string;
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  const move = (from: number, delta: number) => {
    const next = (from + delta + tabs.length) % tabs.length;
    onChange(tabs[next].id);
    refs.current[next]?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label="Backup activity"
      className={cn(
        "inline-flex items-center gap-0.5 rounded-[10px] bg-ink-900 p-1",
        className,
      )}
    >
      {tabs.map((tab, index) => {
        const selected = tab.id === active;
        return (
          <button
            key={tab.id}
            ref={(node) => {
              refs.current[index] = node;
            }}
            role="tab"
            type="button"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.id)}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight") {
                event.preventDefault();
                move(index, 1);
              } else if (event.key === "ArrowLeft") {
                event.preventDefault();
                move(index, -1);
              } else if (event.key === "Home") {
                event.preventDefault();
                onChange(tabs[0].id);
                refs.current[0]?.focus();
              } else if (event.key === "End") {
                event.preventDefault();
                onChange(tabs[tabs.length - 1].id);
                refs.current[tabs.length - 1]?.focus();
              }
            }}
            className={cn(
              "inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-[14px] font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-photon-400",
              selected
                ? "bg-ink-700 text-stone-100"
                : "text-stone-500 hover:text-stone-300",
            )}
          >
            {tab.label}
            {typeof tab.count === "number" && (
              <span
                className={cn(
                  "text-[12px] tabular-nums",
                  selected ? "text-stone-400" : "text-stone-600",
                )}
              >
                {tab.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
