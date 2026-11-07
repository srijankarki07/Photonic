import { Film, Image as ImageIcon } from "lucide-react";
import { cn } from "../lib/cn";
import { mediaUrl } from "../lib/media";

export interface ThumbItem {
  absPath: string;
  mediaType: "image" | "video";
  name?: string;
}

export function ThumbnailGrid({
  items,
  className,
}: {
  items: ThumbItem[];
  className?: string;
}) {
  const visible = items.slice(0, 12);
  if (visible.length === 0) return null;

  return (
    <div
      className={cn(
        "grid gap-1.5 overflow-hidden rounded-[14px]",
        visible.length <= 2 ? "grid-cols-2" : "grid-cols-4",
        className,
      )}
    >
      {visible.map((item, index) => {
        const url = item.mediaType === "image" ? mediaUrl(item.absPath) : null;
        const Icon = item.mediaType === "video" ? Film : ImageIcon;
        return (
          <div
            key={item.absPath}
            className={cn(
              "relative aspect-square overflow-hidden bg-ink-850",
              index === 0 && "col-span-2 row-span-2",
            )}
          >
            <div className="absolute inset-0 grid place-items-center bg-gradient-to-br from-ink-800 to-ink-900 text-stone-700">
              <Icon className="size-5" strokeWidth={1.4} />
            </div>
            {url && (
              <img
                src={url}
                alt=""
                loading={index < 4 ? "eager" : "lazy"}
                decoding="async"
                className="absolute inset-0 h-full w-full object-cover"
                onError={(event) => {
                  event.currentTarget.style.display = "none";
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
