import { useState } from "react";
import { ArrowRight, FolderOpen, Images } from "lucide-react";
import consentContent from "../content/consent.json";
import { BrandMark } from "../components/BrandMark";
import { Button } from "../components/ui";
import { Disclosure } from "../components/Disclosure";
import { StatusDot } from "../components/StatusDot";

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
    <div className="grain relative flex min-h-full items-center justify-center overflow-y-auto bg-ink-950 px-6 py-12">
      <div className="pointer-events-none absolute inset-0 prism-light opacity-70" />
      <div className="relative z-10 w-full max-w-2xl">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5 text-photon-400">
            <BrandMark className="size-7" />
            <span className="text-sm font-semibold tracking-[-0.01em] text-stone-200">
              Photonic
            </span>
          </div>
          <button
            type="button"
            onClick={onTransparency}
            className="cursor-pointer text-[13px] text-stone-500 transition hover:text-stone-200"
          >
            How Photonic works
          </button>
        </div>

        {step === "consent" ? (
          <div className="mt-12">
            <h1 className="font-display text-[40px] leading-[1.08] text-stone-50">
              {consentContent.title}
            </h1>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-stone-400">
              {consentContent.intro}
            </p>
            <ul className="mt-7 space-y-3">
              {consentContent.bullets.map((bullet) => (
                <li key={bullet} className="flex gap-3 text-sm leading-relaxed text-stone-400">
                  <span
                    aria-hidden="true"
                    className="mt-[7px] size-1.5 shrink-0 rounded-full bg-photon-400"
                  />
                  <span>{bullet}</span>
                </li>
              ))}
            </ul>

            <label className="mt-8 flex cursor-pointer items-start gap-3 rounded-[14px] border border-white/[0.08] bg-white/[0.025] p-4">
              <input
                type="checkbox"
                checked={accepted}
                onChange={(event) => setAccepted(event.currentTarget.checked)}
                className="mt-0.5 size-4 shrink-0 accent-photon-400"
              />
              <span className="text-sm leading-relaxed text-stone-300">
                {consentContent.checkbox}
              </span>
            </label>

            <div className="mt-6 flex flex-wrap items-center gap-3">
              <Button variant="primary" onClick={onAccept} disabled={!accepted}>
                {consentContent.continueLabel}
                <ArrowRight className="size-4" />
              </Button>
              <button
                type="button"
                onClick={onTransparency}
                className="cursor-pointer text-[13px] text-stone-500 transition hover:text-stone-200"
              >
                {consentContent.learnMore}
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-12">
            <h1 className="font-display text-[40px] leading-[1.08] text-stone-50">
              You're almost ready.
            </h1>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-stone-400">
              Connect your phone, then choose the folders or photos you want to
              back up. Nothing uploads until you review it.
            </p>

            <div className="mt-9 space-y-8">
              <section>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-[15px] font-semibold text-stone-100">
                      Connect your Android phone
                    </h2>
                    <p className="mt-1 max-w-lg text-sm leading-relaxed text-stone-500">
                      You'll need the ReVanced Photos app with microG, signed in.
                      We'll guide you through the USB steps and sign-in.
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
                <Disclosure title="What you need" className="mt-3">
                  <ul className="space-y-2 text-sm leading-relaxed text-stone-500">
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
                  <p className="mt-2 text-[13px] leading-relaxed text-red-300/80">
                    {keyringError}
                  </p>
                )}
              </section>

              <section>
                <h2 className="text-[15px] font-semibold text-stone-100">
                  Choose what to back up
                </h2>
                <p className="mt-1 text-sm leading-relaxed text-stone-500">
                  Folders include their subfolders. You can also pick individual
                  photos and videos.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
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

            <div className="mt-10 flex items-center justify-between gap-4">
              <button
                type="button"
                onClick={onSkip}
                className="cursor-pointer text-[13px] text-stone-500 transition hover:text-stone-200"
              >
                Do this later
              </button>
              <p className="text-[12px] text-stone-600">
                Your originals stay untouched.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
