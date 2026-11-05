import { cn } from "../lib/cn";

export type StatusTone = "good" | "warn" | "danger" | "muted";

const DOT: Record<StatusTone, string> = {
  good: "bg-emerald-400",
  warn: "bg-photon-400",
  danger: "bg-red-400",
  muted: "bg-stone-600",
};

const TEXT: Record<StatusTone, string> = {
  good: "text-emerald-300",
  warn: "text-photon-300",
  danger: "text-red-300",
  muted: "text-stone-400",
};

export function StatusDot({
  tone = "muted",
  label,
  pulse = false,
  className,
}: {
  tone?: StatusTone;
  label: string;
  pulse?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 text-[13px] font-medium",
        TEXT[tone],
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          DOT[tone],
          pulse && "animate-pulse",
        )}
      />
      <span>{label}</span>
    </span>
  );
}
