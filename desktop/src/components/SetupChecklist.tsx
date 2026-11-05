import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { cn } from "../lib/cn";

export interface SetupStep {
  title: string;
  detail: string;
  state: "done" | "next" | "todo";
  action?: ReactNode;
}

export function SetupChecklist({ steps }: { steps: SetupStep[] }) {
  return (
    <ol className="divide-y divide-white/[0.06]">
      {steps.map((step, index) => (
        <li key={step.title} className="flex items-center gap-3 py-3">
          <span
            aria-hidden="true"
            className={cn(
              "grid size-6 shrink-0 place-items-center rounded-full border text-[12px] font-semibold",
              step.state === "done" &&
                "border-emerald-400/25 bg-emerald-400/10 text-emerald-300",
              step.state === "next" &&
                "border-photon-400/30 bg-photon-400/10 text-photon-300",
              step.state === "todo" &&
                "border-white/10 bg-white/[0.03] text-stone-500",
            )}
          >
            {step.state === "done" ? (
              <Check className="size-3.5" strokeWidth={2.5} />
            ) : (
              index + 1
            )}
          </span>
          <div className="min-w-0 flex-1">
            <p
              className={cn(
                "text-sm font-medium",
                step.state === "todo" ? "text-stone-400" : "text-stone-100",
              )}
            >
              {step.title}
            </p>
            <p className="mt-0.5 text-[13px] leading-relaxed text-stone-500">
              {step.detail}
            </p>
          </div>
          {step.action}
        </li>
      ))}
    </ol>
  );
}
