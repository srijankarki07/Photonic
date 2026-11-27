import type { ButtonHTMLAttributes, Ref } from "react";
import { AlertTriangle, Loader2, type LucideIcon } from "lucide-react";
import { cn } from "../lib/cn";
import { humanizeError } from "../lib/messages";
import type { EngineError } from "../lib/engine/types";
import { BrandMark } from "./BrandMark";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "border border-photon-300/30 bg-photon-400 text-ink-950 font-semibold shadow-[0_10px_24px_-12px_rgba(246,180,92,0.75),inset_0_1px_0_rgba(255,255,255,0.35)] hover:bg-photon-300 active:bg-photon-500",
  secondary:
    "border border-white/[0.11] bg-white/[0.045] text-stone-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] hover:border-white/[0.16] hover:bg-white/[0.08] active:bg-white/[0.05]",
  ghost:
    "border border-transparent text-stone-300 hover:bg-white/[0.06] hover:text-stone-50 active:bg-white/[0.08]",
  danger:
    "border border-red-400/30 bg-red-400/[0.12] text-red-200 hover:border-red-400/40 hover:bg-red-400/[0.18] active:bg-red-400/[0.14]",
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: "gap-1.5 rounded-[9px] px-3 py-1.5 text-[13px] min-h-8",
  md: "gap-2 rounded-[10px] px-4 py-2.5 text-[14px] min-h-10",
};

export function Button({
  ref,
  variant = "secondary",
  size = "md",
  loading = false,
  className,
  children,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  ref?: Ref<HTMLButtonElement>;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}) {
  return (
    <button
      ref={ref}
      type="button"
      disabled={disabled || loading}
      className={cn(
        "inline-flex cursor-pointer items-center justify-center font-medium transition-[background-color,border-color,color,transform,box-shadow] duration-150 ease-out active:scale-[0.985] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-photon-400 disabled:cursor-not-allowed disabled:opacity-45 disabled:active:scale-100",
        BUTTON_VARIANTS[variant],
        BUTTON_SIZES[size],
        className,
      )}
      {...props}
    >
      {loading && <Loader2 className="size-4 animate-spin" />}
      {children}
    </button>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-2.5 text-sm text-stone-300">
      <Loader2 className="size-4 animate-spin text-photon-400" />
      {label && <span>{label}</span>}
    </div>
  );
}

export function ErrorNotice({
  error,
  onRetry,
  retryLabel,
  showCode = false,
}: {
  error: EngineError;
  onRetry?: () => void;
  retryLabel?: string;
  showCode?: boolean;
}) {
  const friendly = humanizeError(error);
  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-[14px] border border-red-400/25 bg-red-400/[0.07] p-4"
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-red-300" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-red-100">{friendly.title}</p>
        <p className="mt-1 text-[13px] leading-relaxed text-red-200/80">
          {friendly.body}
        </p>
        {showCode && (
          <p className="mt-1.5 font-mono text-[11px] text-red-200/60">
            {error.code}
          </p>
        )}
      </div>
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          {retryLabel ?? friendly.action ?? "Try again"}
        </Button>
      )}
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  body,
  action,
  onAction,
}: {
  icon?: LucideIcon;
  title: string;
  body: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <div className="flex min-h-[300px] flex-col items-center justify-center rounded-[16px] border border-white/[0.06] bg-ink-900/45 px-8 py-12 text-center">
      <div className="grid size-12 place-items-center rounded-[12px] border border-white/[0.07] bg-white/[0.03]">
        {Icon ? (
          <Icon className="size-5 text-stone-400" strokeWidth={1.6} />
        ) : (
          <BrandMark className="size-7 text-photon-400/65" />
        )}
      </div>
      <h2 className="display mt-5 text-[22px] text-stone-100">{title}</h2>
      <p className="mt-2 max-w-sm text-sm leading-relaxed text-stone-400">
        {body}
      </p>
      {action && onAction && (
        <div className="mt-6">
          <Button variant="secondary" onClick={onAction}>
            {action}
          </Button>
        </div>
      )}
    </div>
  );
}
