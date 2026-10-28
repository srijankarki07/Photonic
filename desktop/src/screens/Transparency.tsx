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
    <div className="mx-auto w-full max-w-2xl px-8 py-8">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex cursor-pointer items-center gap-1.5 text-[13px] text-stone-500 transition hover:text-stone-200"
      >
        <ArrowLeft className="size-3.5" />
        Back to Settings
      </button>
      <div className="mt-8 flex items-center gap-4">
        <BrandMark className="size-12 text-photon-400" />
        <div>
          <h1 className="font-display text-[34px] leading-tight text-stone-50">
            How Photonic works
          </h1>
          <p className="mt-1 text-sm text-stone-500">
            The short version, with the details behind it.
          </p>
        </div>
      </div>
      <div className="mt-8">
        <TransparencyContent info={info} showPaths />
      </div>
    </div>
  );
}
