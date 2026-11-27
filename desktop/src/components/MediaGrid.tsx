import { Film, Image as ImageIcon } from "lucide-react";
import { cn } from "../lib/cn";
import { formatBytes } from "../lib/format";
import { mediaUrl } from "../lib/media";

export interface MediaGridItem {
  absPath: string;
  mediaType: "image" | "video";
  name: string;
  size?: number;
}

export function MediaGrid({
  items,
  className,
}: {
  items: MediaGridItem[];
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-2 gap-3.5 sm:grid-cols-3 xl:grid-cols-4",
        className,
      )}
    >
      {items.map((item) => {
        const url = item.mediaType === "image" ? mediaUrl(item.absPath) : null;
        const Icon = item.mediaType === "video" ? Film : ImageIcon;
        return (
          <figure key={item.absPath} className="group min-w-0" title={item.name}>
            <div className="relative aspect-square overflow-hidden rounded-[11px] bg-ink-850 ring-1 ring-inset ring-white/[0.08]">
              <div className="absolute inset-0 grid place-items-center bg-gradient-to-br from-ink-800 to-ink-900 text-stone-500">
                <Icon className="size-6" strokeWidth={1.4} />
              </div>
              {url && (
                <img
                  src={url}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className="absolute inset-0 h-full w-full object-cover transition-transform duration-200 ease-out group-hover:scale-[1.03]"
                  onError={(event) => {
                    event.currentTarget.style.display = "none";
                  }}
                />
              )}
              {item.mediaType === "video" && (
                <span className="absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-[6px] border border-white/10 bg-black/75 px-1.5 py-0.5 text-[11px] font-medium text-stone-100 backdrop-blur-xs">
                  <Film className="size-3" strokeWidth={1.8} />
                  Video
                </span>
              )}
            </div>
            <figcaption className="mt-2 min-w-0">
              <p className="truncate text-[13px] font-medium text-stone-200">
                {item.name}
              </p>
              {typeof item.size === "number" && (
                <p className="mt-0.5 text-[12px] tabular-nums text-stone-400">
                  {formatBytes(item.size)}
                </p>
              )}
            </figcaption>
          </figure>
        );
      })}
    </div>
  );
}
