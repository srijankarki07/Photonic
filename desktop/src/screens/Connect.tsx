import { useState } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Button } from "../components/ui";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Disclosure } from "../components/Disclosure";
import { StatusDot } from "../components/StatusDot";
import { TransparencyDialog } from "../components/TransparencyDialog";
import type { EngineInfo } from "../lib/engine/types";
import type { AuthState } from "../lib/engine/useAuth";
import { formatTime } from "../lib/format";

const PHASE_LABELS: Record<string, string> = {
  checking_adb: "Checking your phone connection…",
  waiting_for_device: "Waiting for your phone…",
  waiting_for_authorization: "Accept the USB prompt on your phone",
  waiting_for_screen: "Open the Photos account screen on your phone",
  capturing: "Reading the sign-in…",
  cancelling: "Stopping…",
};

export function Connect({
  auth,
  info,
  onBack,
  onDone,
  onTransparency,
}: {
  auth: AuthState;
  info?: EngineInfo | null;
  onBack: () => void;
  onDone: () => void;
  onTransparency?: () => void;
}) {
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [showTransparency, setShowTransparency] = useState(false);
  const connected = Boolean(auth.status?.connected);
  const deviceReady = Boolean(
    auth.device?.devices.some((device) => device.state === "device"),
  );

  const openTransparency = onTransparency ?? (() => setShowTransparency(true));

  return (
    <div className="mx-auto w-full max-w-2xl px-8 py-8">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex cursor-pointer items-center gap-1.5 text-[13px] text-stone-500 transition hover:text-stone-200"
      >
        <ArrowLeft className="size-3.5" />
        Back
      </button>

      <div className="mt-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-[34px] leading-tight text-stone-50">
            {connected ? "Your Google Photos connection" : "Connect Google Photos"}
          </h1>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-stone-400">
            {connected
              ? "Your sign-in key is stored in your desktop's password manager. It usually lasts about a day."
              : "We'll help you sign in with the Photos app on your Android phone. Photonic never asks for your Google password."}
          </p>
        </div>
        <StatusDot
          tone={connected ? "good" : "muted"}
          label={connected ? "Connected" : "Not connected"}
        />
      </div>

      {auth.loading && (
        <div className="mt-6 flex items-center gap-2 text-sm text-stone-500">
          <Loader2 className="size-4 animate-spin text-photon-400" />
          Checking your saved connection…
        </div>
      )}

      {!auth.loading && connected && (
        <section className="mt-7">
          <div className="rounded-[16px] bg-white/[0.025] px-5 py-4">
            <p className="text-sm font-medium text-stone-100">
              {auth.status?.emailMasked ?? "Google Photos"}
            </p>
            <p className="mt-1 text-[13px] leading-relaxed text-stone-500">
              {auth.status?.capturedAt
                ? `Signed in ${formatTime(auth.status.capturedAt)}. `
                : ""}
              {auth.status?.expiresAt
                ? `Expected to last until ${formatTime(auth.status.expiresAt)}.`
                : ""}
            </p>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="primary" onClick={onDone}>
              {auth.busy ? "Finishing…" : "Done"}
            </Button>
            <Button
              variant="secondary"
              onClick={() => void auth.startCapture()}
              disabled={auth.busy}
            >
              Replace sign-in
            </Button>
            <Button
              variant="ghost"
              onClick={() => setConfirmDisconnect(true)}
              disabled={auth.busy}
            >
              Disconnect
            </Button>
          </div>

          {auth.busy && (
            <div className="mt-4 flex flex-wrap items-center gap-2 rounded-[12px] bg-photon-400/[0.06] px-3 py-2.5">
              <Loader2 className="size-3.5 animate-spin text-photon-300" />
              <p className="min-w-0 flex-1 text-[13px] text-stone-300">
                {auth.message ??
                  PHASE_LABELS[auth.phase ?? ""] ??
                  "Waiting for your phone…"}
              </p>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void auth.cancelCapture()}
              >
                Cancel
              </Button>
            </div>
          )}

          {auth.error && (
            <div className="mt-4 rounded-[12px] bg-red-400/[0.06] px-4 py-3">
              <p className="text-sm text-red-200/80">{auth.error}</p>
              {auth.hint && (
                <p className="mt-1 text-[13px] leading-relaxed text-red-200/55">
                  {auth.hint}
                </p>
              )}
            </div>
          )}

          <p className="mt-4 text-[13px] leading-relaxed text-stone-500">
            Photonic never asks for your Google password.{" "}
            <button
              type="button"
              onClick={openTransparency}
              className="cursor-pointer text-stone-400 underline decoration-stone-700 underline-offset-2 transition hover:text-stone-200"
            >
              How Photonic works
            </button>
          </p>
        </section>
      )}

      {!auth.loading && !connected && (
        <div className="mt-7 space-y-8">
          <Disclosure title="What you need">
            <ul className="space-y-2 text-sm leading-relaxed text-stone-500">
              <li>An Android phone, unlocked, with a USB data cable.</li>
              <li>
                ReVanced Google Photos and the matching microG, signed in. This
                is the modified Photos app that produces the sign-in key.
              </li>
              <li>
                USB debugging enabled. We'll show the steps and wait while you
                do them.
              </li>
            </ul>
            <p className="mt-2 text-[13px] leading-relaxed text-stone-600">
              Photonic never asks for your Google password.
            </p>
          </Disclosure>

          <section>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-[15px] font-semibold text-stone-100">
                  1. Connect your phone
                </h2>
                <p className="mt-1 text-sm leading-relaxed text-stone-500">
                  Enable USB debugging, plug in, and accept the prompt on the
                  phone.
                </p>
              </div>
              <div className="flex items-center gap-2">
                {auth.device && (
                  <StatusDot
                    tone={
                      deviceReady
                        ? "good"
                        : auth.device.adbFound
                          ? "warn"
                          : "danger"
                    }
                    label={
                      deviceReady
                        ? "Phone connected"
                        : auth.device.adbFound
                          ? "Waiting for phone"
                          : "Phone tools missing"
                    }
                  />
                )}
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => void auth.checkDevice()}
                >
                  Check phone
                </Button>
              </div>
            </div>
            {auth.device?.devices.length ? (
              <Disclosure title="Connection details" className="mt-2">
                <ul className="space-y-1.5 text-[13px] text-stone-500">
                  {auth.device.devices.map((device) => (
                    <li key={device.serial} className="flex justify-between gap-3">
                      <span className="truncate font-mono">{device.serial}</span>
                      <span>{device.state}</span>
                    </li>
                  ))}
                </ul>
              </Disclosure>
            ) : null}
            {auth.device && !auth.device.adbFound && (
              <p className="mt-2 text-[13px] leading-relaxed text-stone-500">
                {auth.device.message}
              </p>
            )}
          </section>

          <section>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-[15px] font-semibold text-stone-100">
                  2. Sign in
                </h2>
                <p className="mt-1 text-sm leading-relaxed text-stone-500">
                  Start listening, then open the Photos account screen on your
                  phone.
                </p>
              </div>
              <div className="flex items-center gap-2">
                {auth.busy && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void auth.cancelCapture()}
                  >
                    Cancel
                  </Button>
                )}
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => void auth.startCapture()}
                  disabled={auth.busy}
                >
                  {auth.busy ? "Listening…" : "Start sign-in"}
                </Button>
              </div>
            </div>

            {auth.busy && (
              <div className="mt-3 flex items-center gap-2 rounded-[12px] bg-photon-400/[0.06] px-3 py-2.5">
                <Loader2 className="size-3.5 animate-spin text-photon-300" />
                <p className="text-[13px] text-stone-300">
                  {auth.message ??
                    PHASE_LABELS[auth.phase ?? ""] ??
                    "Waiting for your phone…"}
                </p>
              </div>
            )}

            {!auth.busy && auth.phase === "cancelled" && (
              <p className="mt-2 text-[13px] text-stone-500">{auth.message}</p>
            )}
          </section>

          {auth.error && (
            <div className="rounded-[12px] bg-red-400/[0.06] px-4 py-3">
              <p className="text-sm text-red-200/80">{auth.error}</p>
              {auth.hint && (
                <p className="mt-1 text-[13px] leading-relaxed text-red-200/55">
                  {auth.hint}
                </p>
              )}
            </div>
          )}

          {auth.status && !auth.status.keyringAvailable && (
            <p className="text-[13px] leading-relaxed text-red-300/80">
              {auth.status.error ??
                "Your desktop's password manager is unavailable. Photonic will not store the sign-in key in plaintext."}
            </p>
          )}

          <p className="text-[13px] leading-relaxed text-stone-500">
            <button
              type="button"
              onClick={openTransparency}
              className="cursor-pointer text-stone-400 underline decoration-stone-700 underline-offset-2 transition hover:text-stone-200"
            >
              How Photonic works
            </button>
          </p>
        </div>
      )}

      <ConfirmDialog
        open={confirmDisconnect}
        title="Disconnect Google Photos?"
        body="This removes the saved sign-in key from your password manager. Nothing already in Google Photos is deleted."
        confirmLabel="Disconnect"
        danger
        onConfirm={() => {
          setConfirmDisconnect(false);
          void auth.disconnect();
        }}
        onCancel={() => setConfirmDisconnect(false)}
      />

      <TransparencyDialog
        open={showTransparency}
        onClose={() => setShowTransparency(false)}
        info={info}
      />
    </div>
  );
}
