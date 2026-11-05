import type { ButtonHTMLAttributes } from "react";
import { AlertTriangle, Loader2, type LucideIcon } from "lucide-react";
import { cn } from "../lib/cn";
import { humanizeError } from "../lib/messages";
import type { EngineError } from "../lib/engine/types";
import { BrandMark } from "./BrandMark";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "border border-transparent bg-photon-400 text-ink-950 shadow-[0_10px_30px_-16px_rgba(246,180,92,0.8)] hover:bg-photon-300",
  secondary:
    "border border-white/10 bg-white/[0.035] text-stone-200 hover:bg-white/[0.065]",
  ghost:
    "border border-transparent text-stone-400 hover:bg-white/[0.05] hover:text-stone-100",
  danger:
    "border border-red-400/25 bg-red-400/10 text-red-300 hover:bg-red-400/15",
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: "gap-1.5 rounded-[9px] px-3 py-1.5 text-[13px]",
  md: "gap-2 rounded-[10px] px-4 py-2.5 text-[15px]",
};

export function Button({
  variant = "secondary",
  size = "md",
  loading = false,
  className,
  children,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled || loading}
      className={cn(
        "inline-flex cursor-pointer items-center justify-center font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-photon-400 disabled:cursor-not-allowed disabled:opacity-50",
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
    <div className="flex items-center gap-2 text-sm text-stone-400">
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
      className="flex items-start gap-3 rounded-[14px] border border-red-400/20 bg-red-400/[0.05] p-4"
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-red-300" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-red-200">{friendly.title}</p>
        <p className="mt-1 text-[13px] leading-relaxed text-red-200/65">
          {friendly.body}
        </p>
        {showCode && (
          <p className="mt-1.5 font-mono text-[11px] text-red-200/40">
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
    <div className="flex min-h-[320px] flex-col items-center justify-center px-8 text-center">
      {Icon ? (
        <Icon className="size-6 text-stone-600" strokeWidth={1.5} />
      ) : (
        <BrandMark className="size-10 text-photon-400/35" />
      )}
      <h2 className="mt-5 font-display text-[22px] text-stone-100">{title}</h2>
      <p className="mt-2 max-w-sm text-sm leading-relaxed text-stone-500">
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
