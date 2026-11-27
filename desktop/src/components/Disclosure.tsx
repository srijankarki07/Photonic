import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "../lib/cn";

export function Disclosure({
  title,
  children,
  defaultOpen = false,
  className,
}: {
  title: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
}) {
  return (
    <details
      className={cn("group", className)}
      open={defaultOpen ? true : undefined}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-[8px] py-2.5 text-sm font-medium text-stone-200 transition hover:text-stone-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-photon-400 [&::-webkit-details-marker]:hidden">
        {title}
        <ChevronDown
          className="size-4 shrink-0 text-stone-400 transition-transform duration-200 ease-out group-open:rotate-180"
          strokeWidth={1.8}
        />
      </summary>
      <div className="pb-2.5 pt-1">{children}</div>
    </details>
  );
}
