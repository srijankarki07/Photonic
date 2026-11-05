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
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 py-2.5 text-sm font-medium text-stone-300 transition hover:text-stone-100 [&::-webkit-details-marker]:hidden">
        {title}
        <ChevronDown
          className="size-4 text-stone-600 transition-transform duration-200 group-open:rotate-180"
          strokeWidth={1.8}
        />
      </summary>
      <div className="pb-2">{children}</div>
    </details>
  );
}
