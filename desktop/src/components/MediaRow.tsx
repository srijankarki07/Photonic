import { memo, type ReactNode } from "react";
import { Film, Image as ImageIcon } from "lucide-react";
import { cn } from "../lib/cn";
import { formatBytes } from "../lib/format";
import { mediaUrl } from "../lib/media";
import { StatusDot, type StatusTone } from "./StatusDot";

export interface MediaRowProps {
  name: string;
  parent?: string;
  mediaType: "image" | "video";
  absPath?: string;
  size?: number;
  meta?: string;
  state?: { label: string; tone: StatusTone };
  trailing?: ReactNode;
  onClick?: () => void;
}

function MediaRowComponent({
  name,
  parent,
  mediaType,
  absPath,
  size,
  meta,
  state,
  trailing,
  onClick,
}: MediaRowProps) {
  const url = mediaType === "image" ? mediaUrl(absPath) : null;
  const Icon = mediaType === "video" ? Film : ImageIcon;
  const detail = [
    parent,
    typeof size === "number" ? formatBytes(size) : null,
    meta,
  ]
    .filter(Boolean)
    .join(" · ");

  const content = (
    <>
      <div className="relative size-11 shrink-0 overflow-hidden rounded-[9px] bg-ink-850 ring-1 ring-inset ring-white/[0.08]">
        <div className="absolute inset-0 grid place-items-center text-stone-500">
          <Icon className="size-4" strokeWidth={1.5} />
        </div>
        {url && (
          <img
            src={url}
            alt=""
            loading="lazy"
            decoding="async"
            className="absolute inset-0 h-full w-full object-cover"
            onError={(event) => {
              event.currentTarget.style.display = "none";
            }}
          />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[14px] font-medium text-stone-100">
          {name}
        </p>
        {detail && (
          <p className="mt-0.5 truncate text-[13px] tabular-nums text-stone-400">
            {detail}
          </p>
        )}
      </div>
      {state && <StatusDot tone={state.tone} label={state.label} />}
      {trailing}
    </>
  );

  const className =
    "flex w-full items-center gap-3 rounded-[10px] px-2 py-2.5 text-left transition-colors duration-150 hover:bg-white/[0.03] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-photon-400";

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={cn(className, "cursor-pointer")}
      >
        {content}
      </button>
    );
  }

  return <div className={className}>{content}</div>;
}

/**
 * Only re-render a row when its own data changes. The Activity list can hold
 * hundreds of rows and receives progress updates several times a second.
 */
export const MediaRow = memo(
  MediaRowComponent,
  (previous, next) =>
    previous.name === next.name &&
    previous.parent === next.parent &&
    previous.mediaType === next.mediaType &&
    previous.absPath === next.absPath &&
    previous.size === next.size &&
    previous.meta === next.meta &&
    previous.state?.label === next.state?.label &&
    previous.state?.tone === next.state?.tone &&
    previous.trailing === next.trailing &&
    previous.onClick === next.onClick,
);
