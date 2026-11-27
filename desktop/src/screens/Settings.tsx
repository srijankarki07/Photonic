import { useMemo, useState } from "react";
import { Button, ErrorNotice, Spinner } from "../components/ui";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Disclosure } from "../components/Disclosure";
import { StatusDot } from "../components/StatusDot";
import type { AuthState } from "../lib/engine/useAuth";
import type { EngineState } from "../lib/engine/useEngine";
import { formatTime, shortenPath } from "../lib/format";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-6 border-b border-white/[0.06] py-2.5 last:border-b-0">
      <span className="shrink-0 text-[13px] text-stone-400">{label}</span>
      <span
        className="min-w-0 truncate text-right font-mono text-[13px] tabular-nums text-stone-200"
        title={value}
      >
        {value}
      </span>
    </div>
  );
}

export function Settings({
  engine,
  auth,
  onConnect,
  onTransparency,
  onClearHistory,
}: {
  engine: EngineState;
  auth: AuthState;
  onConnect: () => void;
  onTransparency: () => void;
  onClearHistory: () => Promise<void>;
}) {
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [copied, setCopied] = useState(false);
  const connected = Boolean(auth.status?.connected);
  const info = engine.info;
  const status = engine.status;

  const diagnostics = useMemo(
    () =>
      JSON.stringify(
        { status, info, logs: engine.logs.slice(-20) },
        null,
        2,
      ),
    [status, info, engine.logs],
  );

  async function copyDiagnostics() {
    try {
      await navigator.clipboard.writeText(diagnostics);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-8 py-9">
      <h1 className="text-[34px] leading-tight text-stone-50">Settings</h1>
      <p className="mt-1.5 text-sm text-stone-400">
        Your connection, local data, and the details behind Photonic.
      </p>

      <div className="mt-8 space-y-4">
        <section className="surface-panel rounded-[16px] p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-[15px] font-semibold text-stone-100">
              Google Photos
            </h2>
            {!auth.loading && (
              <StatusDot
                tone={connected ? "good" : "muted"}
                label={
                  connected
                    ? `Connected${auth.status?.emailMasked ? ` as ${auth.status.emailMasked}` : ""}`
                    : "Not connected"
                }
              />
            )}
          </div>

          {auth.loading ? (
            <div className="mt-4">
              <Spinner label="Checking your connection…" />
            </div>
          ) : connected ? (
            <div className="mt-4">
              <div className="rounded-[10px] border border-white/[0.06] bg-ink-950/45 px-3.5">
                <Row
                  label="Captured"
                  value={
                    auth.status?.capturedAt
                      ? formatTime(auth.status.capturedAt)
                      : "-"
                  }
                />
                <Row
                  label="Expected to last until"
                  value={
                    auth.status?.expiresAt
                      ? formatTime(auth.status.expiresAt)
                      : "-"
                  }
                />
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button variant="secondary" size="sm" onClick={onConnect}>
                  Manage connection
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setConfirmDisconnect(true)}
                >
                  Disconnect
                </Button>
              </div>
              <p className="mt-3 text-[13px] leading-relaxed text-stone-400">
                The sign-in key is kept in your desktop's password manager.
                Disconnecting removes it; items already in Google Photos stay
                there.
              </p>
            </div>
          ) : (
            <div className="mt-3">
              <p className="max-w-lg text-sm leading-relaxed text-stone-400">
                Connect the ReVanced Photos app on your Android phone to start
                backing up. Photonic never asks for your Google password.
              </p>
              <div className="mt-4">
                <Button variant="primary" size="sm" onClick={onConnect}>
                  Connect Google Photos
                </Button>
              </div>
            </div>
          )}

          {auth.status && !auth.status.keyringAvailable && (
            <p className="mt-3 text-[13px] leading-relaxed text-red-300">
              {auth.status.error ??
                "Your desktop's password manager is unavailable. Photonic will not store the sign-in key in plaintext."}
            </p>
          )}
          {auth.error && (
            <p className="mt-3 text-[13px] leading-relaxed text-red-300">
              {auth.error}
              {auth.hint ? ` ${auth.hint}` : ""}
            </p>
          )}
        </section>

        <section className="surface-panel rounded-[16px] p-5">
          <h2 className="text-[15px] font-semibold text-stone-100">
            How Photonic works
          </h2>
          <p className="mt-1.5 max-w-lg text-sm leading-relaxed text-stone-400">
            A plain-language explanation of where your photos go, what stays on
            this computer, the account risk, and how to disconnect.
          </p>
          <div className="mt-4">
            <Button variant="secondary" size="sm" onClick={onTransparency}>
              Read the explanation
            </Button>
          </div>
        </section>

        <section className="surface-panel rounded-[16px] px-5 py-2.5">
          <Disclosure title="Advanced details">
            <div className="space-y-5 pt-2">
              {engine.error && (
                <ErrorNotice
                  error={engine.error}
                  onRetry={() => void engine.refresh()}
                  showCode
                />
              )}

              <div>
                <div className="flex items-center justify-between">
                  <p className="text-[13px] font-medium text-stone-300">
                    Backup service
                  </p>
                  <StatusDot
                    tone={
                      status?.ready ? "good" : engine.error ? "danger" : "warn"
                    }
                    label={
                      status?.ready
                        ? "Ready"
                        : status?.running
                          ? "Starting"
                          : "Stopped"
                    }
                  />
                </div>
                <div className="mt-2.5 rounded-[10px] border border-white/[0.06] bg-ink-950/45 px-3.5">
                  <Row label="Version" value={info?.version ?? "-"} />
                  <Row label="Python" value={info?.python ?? "-"} />
                  <Row label="Platform" value={info?.platform ?? "-"} />
                  <Row
                    label="Upload tool"
                    value={
                      info?.binaries.gpmc.found
                        ? (info.binaries.gpmc.path ?? "found")
                        : "not found"
                    }
                  />
                  <Row
                    label="Data folder"
                    value={info ? shortenPath(info.dataDir) : "-"}
                  />
                  <Row
                    label="Log file"
                    value={info ? shortenPath(info.logFile) : "-"}
                  />
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => void copyDiagnostics()}
                >
                  {copied ? "Copied" : "Copy troubleshooting info"}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void engine.refresh()}
                  loading={engine.loading}
                >
                  Check again
                </Button>
              </div>

              <div className="border-t border-white/[0.06] pt-4">
                <p className="text-[14px] font-medium text-stone-200">
                  Backup history
                </p>
                <p className="mt-1 text-[13px] leading-relaxed text-stone-400">
                  Finished backups are kept on this computer so you can see what
                  happened. Clearing them does not touch Google Photos or your
                  original files.
                </p>
                <Button
                  variant="danger"
                  size="sm"
                  className="mt-3"
                  onClick={() => setConfirmClear(true)}
                >
                  Clear finished backups
                </Button>
              </div>

              <div className="border-t border-white/[0.06] pt-2">
                <Disclosure title="Diagnostics data">
                  <pre className="max-h-64 overflow-auto rounded-[10px] border border-white/[0.06] bg-ink-950/80 p-3.5 font-mono text-[11px] leading-relaxed text-stone-300">
                    {diagnostics}
                  </pre>
                </Disclosure>
              </div>
            </div>
          </Disclosure>
        </section>

        <section className="surface-panel rounded-[16px] p-5">
          <h2 className="text-[15px] font-semibold text-stone-100">About</h2>
          <p className="mt-1.5 text-sm leading-relaxed text-stone-400">
            Photonic 0.1.1 · an independent, local-first app. Not made by,
            endorsed by, or supported by Google or the ReVanced project.
          </p>
        </section>
      </div>

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

      <ConfirmDialog
        open={confirmClear}
        title="Clear finished backups?"
        body="This removes the history of completed, cancelled, and failed backups from this computer. Google Photos and your original files are not affected. A running backup is kept."
        confirmLabel="Clear history"
        danger
        onConfirm={() => {
          setConfirmClear(false);
          void onClearHistory();
        }}
        onCancel={() => setConfirmClear(false)}
      />
    </div>
  );
}
