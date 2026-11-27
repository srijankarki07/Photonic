import { useState } from "react";
import { ArrowRight, FolderOpen, Images } from "lucide-react";
import consentContent from "../content/consent.json";
import { BrandMark } from "../components/BrandMark";
import { Button } from "../components/ui";
import { Disclosure } from "../components/Disclosure";
import { StatusDot } from "../components/StatusDot";
import { cn } from "../lib/cn";

export function Onboarding({
  step,
  connected,
  emailMasked,
  keyringError,
  onAccept,
  onConnect,
  onChooseFolder,
  onChooseFiles,
  onSkip,
  onTransparency,
}: {
  step: "consent" | "setup";
  connected: boolean;
  emailMasked: string | null;
  keyringError?: string | null;
  onAccept: () => void;
  onConnect: () => void;
  onChooseFolder: () => void;
  onChooseFiles: () => void;
  onSkip: () => void;
  onTransparency: () => void;
}) {
  const [accepted, setAccepted] = useState(false);

  return (
    <div className="relative flex min-h-full items-center justify-center overflow-y-auto bg-ink-950 px-6 py-12">
      <div className="pointer-events-none absolute inset-0 prism-light opacity-65" />
      <div className="relative z-10 w-full max-w-2xl">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5 text-photon-400">
            <BrandMark className="size-7" />
            <span className="text-[15px] font-semibold tracking-[-0.015em] text-stone-100">
              Photonic
            </span>
          </div>
          <button
            type="button"
            onClick={onTransparency}
            className="cursor-pointer rounded-[6px] text-[13px] font-medium text-stone-400 transition hover:text-stone-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-photon-400"
          >
            How Photonic works
          </button>
        </div>

        {step === "consent" ? (
          <div className="mt-10">
            <h1 className="text-[38px] leading-[1.08] text-stone-50">
              {consentContent.title}
            </h1>
            <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-stone-300">
              {consentContent.intro}
            </p>
            <ul className="surface-panel mt-7 space-y-3 rounded-[16px] p-5">
              {consentContent.bullets.map((bullet) => (
                <li
                  key={bullet}
                  className="flex gap-3 text-sm leading-relaxed text-stone-300"
                >
                  <span
                    aria-hidden="true"
                    className="mt-[8px] size-1.5 shrink-0 rounded-full bg-photon-400"
                  />
                  <span>{bullet}</span>
                </li>
              ))}
            </ul>

            <label
              className={cn(
                "mt-5 flex cursor-pointer items-start gap-3 rounded-[14px] border p-4 transition-colors duration-150 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-photon-400",
                accepted
                  ? "border-photon-400/35 bg-photon-400/[0.07]"
                  : "border-white/[0.09] bg-ink-900/60 hover:border-white/[0.15] hover:bg-ink-850/70",
              )}
            >
              <input
                type="checkbox"
                checked={accepted}
                onChange={(event) => setAccepted(event.currentTarget.checked)}
                className="mt-0.5 size-4 shrink-0 accent-photon-400"
              />
              <span className="text-sm font-medium leading-relaxed text-stone-100">
                {consentContent.checkbox}
              </span>
            </label>

            <div className="mt-6 flex flex-wrap items-center gap-4">
              <Button variant="primary" onClick={onAccept} disabled={!accepted}>
                {consentContent.continueLabel}
                <ArrowRight className="size-4" />
              </Button>
              <button
                type="button"
                onClick={onTransparency}
                className="cursor-pointer rounded-[6px] text-[13px] font-medium text-stone-400 transition hover:text-stone-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-photon-400"
              >
                {consentContent.learnMore}
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-10">
            <h1 className="text-[38px] leading-[1.08] text-stone-50">
              You're almost ready.
            </h1>
            <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-stone-300">
              Connect your phone, then choose the folders or photos you want to
              back up. Nothing uploads until you review it.
            </p>

            <div className="mt-8 space-y-4">
              <section className="surface-panel rounded-[16px] p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <h2 className="text-[15px] font-semibold text-stone-100">
                      Connect your Android phone
                    </h2>
                    <p className="mt-1 max-w-lg text-sm leading-relaxed text-stone-400">
                      You'll need the ReVanced Photos app with microG, signed
                      in. We'll guide you through the USB steps and sign-in.
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <StatusDot
                      tone={connected ? "good" : "muted"}
                      label={
                        connected
                          ? `Connected${emailMasked ? ` as ${emailMasked}` : ""}`
                          : "Not connected"
                      }
                    />
                    <Button
                      variant={connected ? "secondary" : "primary"}
                      size="sm"
                      onClick={onConnect}
                    >
                      {connected ? "Manage connection" : "Connect your phone"}
                    </Button>
                  </div>
                </div>
                <Disclosure title="What you need" className="mt-3 border-t border-white/[0.06] pt-1">
                  <ul className="space-y-2 text-sm leading-relaxed text-stone-300">
                    <li>An Android phone, unlocked, with a USB cable.</li>
                    <li>
                      ReVanced Google Photos and the matching microG, signed in.
                    </li>
                    <li>
                      USB debugging enabled. We'll show the exact steps on the
                      next screen.
                    </li>
                  </ul>
                </Disclosure>
                {keyringError && (
                  <p className="mt-2 text-[13px] leading-relaxed text-red-300">
                    {keyringError}
                  </p>
                )}
              </section>

              <section className="surface-panel rounded-[16px] p-5">
                <h2 className="text-[15px] font-semibold text-stone-100">
                  Choose what to back up
                </h2>
                <p className="mt-1 text-sm leading-relaxed text-stone-400">
                  Folders include their subfolders. You can also pick individual
                  photos and videos.
                </p>
                <div className="mt-4 flex flex-wrap gap-2.5">
                  <Button variant="primary" onClick={onChooseFolder}>
                    <FolderOpen className="size-4" />
                    Choose folders
                  </Button>
                  <Button variant="secondary" onClick={onChooseFiles}>
                    <Images className="size-4" />
                    Choose photos
                  </Button>
                </div>
              </section>
            </div>

            <div className="mt-8 flex items-center justify-between gap-4">
              <button
                type="button"
                onClick={onSkip}
                className="cursor-pointer rounded-[6px] text-[13px] font-medium text-stone-400 transition hover:text-stone-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-photon-400"
              >
                Do this later
              </button>
              <p className="text-[12px] text-stone-400">
                Your originals stay untouched.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
