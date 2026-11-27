import { ArrowLeft } from "lucide-react";
import { BrandMark } from "../components/BrandMark";
import { TransparencyContent } from "../components/TransparencyContent";
import type { EngineInfo } from "../lib/engine/types";

export function Transparency({
  info,
  onBack,
}: {
  info?: EngineInfo | null;
  onBack: () => void;
}) {
  return (
    <div className="mx-auto w-full max-w-2xl px-8 py-9">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex cursor-pointer items-center gap-1.5 rounded-[6px] text-[13px] font-medium text-stone-400 transition hover:text-stone-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-photon-400"
      >
        <ArrowLeft className="size-3.5" />
        Back to Settings
      </button>
      <div className="mt-7 flex items-center gap-4">
        <BrandMark className="size-11 text-photon-400" />
        <div>
          <h1 className="text-[34px] leading-tight text-stone-50">
            How Photonic works
          </h1>
          <p className="mt-1 text-sm text-stone-400">
            The short version, with the details behind it.
          </p>
        </div>
      </div>
      <div className="surface-panel mt-8 rounded-[16px] p-6">
        <TransparencyContent info={info} showPaths />
      </div>
    </div>
  );
}
