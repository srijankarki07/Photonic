import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import {
  FolderOpen,
  History as HistoryIcon,
  Settings as SettingsIcon,
} from "lucide-react";
import { cn } from "./lib/cn";
import {
  clearHistory as clearHistoryRequest,
  scanSelection,
  toEngineError,
} from "./lib/engine/client";
import type { EngineError, ScanResult } from "./lib/engine/types";
import { useAuth } from "./lib/engine/useAuth";
import { useEngine } from "./lib/engine/useEngine";
import { useJobs } from "./lib/engine/useJobs";
import { pickFiles, pickFolders } from "./lib/native";
import {
  authNotice,
  isAuthExpired,
  type AuthNotice,
} from "./lib/authExpiry";
import {
  CONSENT_VERSION,
  loadPreferences,
  needsConsent,
  savePreferences,
  type Preferences,
} from "./lib/prefs";
import { BrandMark } from "./components/BrandMark";
import { AuthBanner } from "./components/AuthBanner";
import { StatusDot } from "./components/StatusDot";
import { Toast, type ToastTone } from "./components/Toast";
import { Button } from "./components/ui";
import { TransparencyDialog } from "./components/TransparencyDialog";
import { Backup } from "./screens/Backup";
import { Review } from "./screens/Review";
import { Connect } from "./screens/Connect";
import { Activity } from "./screens/Activity";
import { Settings } from "./screens/Settings";
import { Onboarding } from "./screens/Onboarding";
import { Transparency } from "./screens/Transparency";

type Section = "backup" | "activity" | "settings";
type ConnectReturn = "review" | "onboarding" | null;
type Flow =
  | { kind: "review" }
  | { kind: "connect"; returnTo: ConnectReturn }
  | { kind: "transparency" }
  | null;

const NAV: Array<{ id: Section; label: string; icon: typeof FolderOpen }> = [
  { id: "backup", label: "Back up", icon: FolderOpen },
  { id: "activity", label: "Activity", icon: HistoryIcon },
  { id: "settings", label: "Settings", icon: SettingsIcon },
];

function App() {
  const engine = useEngine();
  const auth = useAuth();
  const jobs = useJobs();

  const [prefs, setPrefs] = useState<Preferences>(() => loadPreferences());
  const [onboardingOpen, setOnboardingOpen] = useState(
    () => needsConsent(prefs) || !prefs.onboardingSeen,
  );
  const [onboardingStep, setOnboardingStep] = useState<"consent" | "setup">(
    () => (needsConsent(prefs) ? "consent" : "setup"),
  );
  const [transparencyOpen, setTransparencyOpen] = useState(false);

  const [section, setSection] = useState<Section>("backup");
  const [flow, setFlow] = useState<Flow>(null);
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [selection, setSelection] = useState<string[]>([]);
  const [scanLabel, setScanLabel] = useState("");
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<EngineError | null>(null);
  const [toast, setToast] = useState<{ message: string; tone: ToastTone } | null>(
    null,
  );
  const [dragging, setDragging] = useState(false);
  const [now, setNow] = useState(() => Date.now() / 1000);
  const [dismissedNotice, setDismissedNotice] = useState<AuthNotice | null>(
    null,
  );

  const notify = useCallback((message: string, tone: ToastTone = "info") => {
    setToast({ message, tone });
  }, []);

  const dismissToast = useCallback(() => setToast(null), []);

  const markOnboardingSeen = useCallback(() => {
    const next = savePreferences({ onboardingSeen: true });
    setPrefs(next);
    setOnboardingOpen(false);
  }, []);

  const runScan = useCallback(
    async (paths: string[]) => {
      const unique = Array.from(
        new Set(paths.map((path) => path.trim()).filter(Boolean)),
      );
      if (unique.length === 0) return;
      if (onboardingOpen) markOnboardingSeen();
      setSelection(unique);
      setScanLabel(
        unique.length === 1
          ? unique[0]
          : `${unique.length} selected locations`,
      );
      setFlow({ kind: "review" });
      setScan(null);
      setScanError(null);
      setScanning(true);
      try {
        const result = await scanSelection(unique);
        setScan(result);
      } catch (caught) {
        setScanError(toEngineError(caught));
      } finally {
        setScanning(false);
      }
    },
    [onboardingOpen, markOnboardingSeen],
  );

  const chooseFolder = useCallback(async () => {
    try {
      const folders = await pickFolders();
      if (folders?.length) await runScan(folders);
    } catch (caught) {
      notify(toEngineError(caught).message, "danger");
    }
  }, [runScan, notify]);

  const chooseFiles = useCallback(async () => {
    try {
      const files = await pickFiles();
      if (files?.length) await runScan(files);
    } catch (caught) {
      notify(toEngineError(caught).message, "danger");
    }
  }, [runScan, notify]);

  const addFiles = useCallback(async () => {
    try {
      const files = await pickFiles();
      if (files?.length) await runScan([...selection, ...files]);
    } catch (caught) {
      notify(toEngineError(caught).message, "danger");
    }
  }, [selection, runScan, notify]);

  const retryScan = useCallback(() => {
    if (selection.length) void runScan(selection);
    else void chooseFolder();
  }, [selection, runScan, chooseFolder]);

  const acceptConsent = useCallback(() => {
    const next = savePreferences({
      consentVersion: CONSENT_VERSION,
      acceptedAt: new Date().toISOString(),
    });
    setPrefs(next);
    setOnboardingStep("setup");
  }, []);

  const skipOnboarding = useCallback(() => {
    markOnboardingSeen();
    setFlow(null);
    setSection("backup");
  }, [markOnboardingSeen]);

  const openConnect = useCallback(
    (returnTo: ConnectReturn) => setFlow({ kind: "connect", returnTo }),
    [],
  );

  const closeConnect = useCallback(() => {
    if (flow?.kind === "connect") {
      if (flow.returnTo === "review") {
        setFlow({ kind: "review" });
        return;
      }
      if (flow.returnTo === "onboarding") {
        setFlow(null);
        setOnboardingStep("setup");
        return;
      }
    }
    setFlow(null);
  }, [flow]);

  const handleUpload = useCallback(
    async (
      policy: "timeline" | "per_job" | "per_folder",
      albumName: string | null,
    ): Promise<boolean> => {
      if (selection.length === 0) {
        notify("Choose folders or photos first.", "info");
        return false;
      }
      if (jobs.job && jobs.job.finishedAt === null) {
        notify("A backup is already running.", "info");
        setSection("activity");
        setFlow(null);
        return false;
      }
      if (!auth.status?.connected) {
        notify("Connect Google Photos first.", "info");
        setFlow({ kind: "connect", returnTo: "review" });
        return false;
      }
      if (isAuthExpired(auth.status, now)) {
        notify("Your Google Photos sign-in expired. Reconnect to continue.", "info");
        setFlow({ kind: "connect", returnTo: "review" });
        return false;
      }
      const id = await jobs.start({
        paths: selection,
        files: scan?.files.map((file) => ({
          absPath: file.absPath,
          path: file.path,
          size: file.size,
          mediaType: file.mediaType,
          mtime: file.mtime,
        })),
        albumPolicy: policy,
        albumName,
        includeHidden: false,
      });
      if (id) {
        // The scan belonged to the upload that just started. Clearing it keeps
        // the Back up page from showing a stale "ready" list afterwards.
        setScan(null);
        setSelection([]);
        setScanLabel("");
        setSection("activity");
        setFlow(null);
        notify("Backup started.", "success");
        return true;
      }
      notify("The backup couldn't start. Open Activity for details.", "danger");
      return false;
    },
    [selection, scan, auth.status, now, jobs, notify],
  );

  const openJob = useCallback(
    async (jobId: string) => {
      await jobs.openJob(jobId);
      setSection("activity");
      setFlow(null);
    },
    [jobs],
  );

  const retryJob = useCallback(
    (jobId: string, includeUncertain: boolean) => {
      void jobs.retryFailed(includeUncertain, jobId);
    },
    [jobs],
  );

  const clearHistory = useCallback(async () => {
    try {
      const { removed } = await clearHistoryRequest();
      await jobs.loadHistory();
      jobs.closeJob();
      notify(
        removed
          ? `Cleared ${removed} finished backup${removed === 1 ? "" : "s"}.`
          : "There were no finished backups to clear.",
        "success",
      );
    } catch (caught) {
      notify(toEngineError(caught).message, "danger");
    }
  }, [jobs, notify]);

  const resumeJob = useCallback(
    (jobId: string) => {
      void jobs.resume(jobId);
    },
    [jobs],
  );

  useEffect(() => {
    if (engine.status?.ready) void jobs.loadHistory();
  }, [engine.status?.ready, jobs.loadHistory]);

  // Re-evaluate token lifetime and recovery state without polling the engine.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now() / 1000), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const needsAuth =
    jobs.authRequired ||
    jobs.job?.status === "needs_auth" ||
    jobs.recovered.some((job) => job.status === "needs_auth");
  const notice = authNotice(auth.status, needsAuth, now);
  const authExpired = isAuthExpired(auth.status, now);

  // A new notice should be shown even if an older one was dismissed.
  useEffect(() => {
    if (!notice) setDismissedNotice(null);
  }, [notice]);

  const announcedJob = useRef<string | null>(null);
  useEffect(() => {
    const current = jobs.job;
    if (!current) return;
    if (current.finishedAt === null) {
      announcedJob.current = null;
      return;
    }
    if (announcedJob.current === current.id) return;
    announcedJob.current = current.id;
    if (current.status === "completed") {
      notify("Backup finished. Your photos are in Google Photos.", "success");
    } else if (current.status === "completed_with_failures") {
      notify("Backup finished, but some files need attention.", "danger");
    } else if (current.status === "cancelled") {
      notify("Backup stopped.", "info");
    }
  }, [jobs.job, notify]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;

    getCurrentWebview()
      .onDragDropEvent((event) => {
        const payload = event.payload;
        if (payload.type === "enter") {
          setDragging(true);
        } else if (payload.type === "leave") {
          setDragging(false);
        } else if (payload.type === "drop") {
          setDragging(false);
          if (payload.paths.length) void runScan(payload.paths);
        }
      })
      .then((stop) => {
        if (disposed) stop();
        else unlisten = stop;
      })
      .catch(() => {
        // Browser preview has no native drag/drop.
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [runScan]);

  const goSection = useCallback((next: Section) => {
    setSection(next);
    setFlow(null);
  }, []);

  if (onboardingOpen && flow?.kind !== "connect") {
    return (
      <>
        <Onboarding
          step={onboardingStep}
          connected={Boolean(auth.status?.connected)}
          emailMasked={auth.status?.emailMasked ?? null}
          keyringError={
            auth.status && !auth.status.keyringAvailable
              ? (auth.status.error ?? "Your password manager is unavailable.")
              : null
          }
          onAccept={acceptConsent}
          onConnect={() => openConnect("onboarding")}
          onChooseFolder={() => void chooseFolder()}
          onChooseFiles={() => void chooseFiles()}
          onSkip={skipOnboarding}
          onTransparency={() => setTransparencyOpen(true)}
        />
        <TransparencyDialog
          open={transparencyOpen}
          onClose={() => setTransparencyOpen(false)}
          info={engine.info}
        />
      </>
    );
  }

  if (onboardingOpen && flow?.kind === "connect") {
    return (
      <Connect
        auth={auth}
        info={engine.info}
        onBack={closeConnect}
        onDone={closeConnect}
      />
    );
  }

  const flowContent =
    flow?.kind === "review" ? (
      <Review
        selection={selection}
        selectionLabel={scanLabel}
        scan={scan}
        scanning={scanning}
        error={scanError}
        auth={auth}
        uploading={jobs.starting}
        onChooseFolder={() => void chooseFolder()}
        onChooseFiles={() => void addFiles()}
        onRetry={retryScan}
        onBack={() => setFlow(null)}
        onConnect={() => openConnect("review")}
        onUpload={handleUpload}
      />
    ) : flow?.kind === "connect" ? (
      <Connect
        auth={auth}
        info={engine.info}
        onBack={closeConnect}
        onDone={closeConnect}
      />
    ) : flow?.kind === "transparency" ? (
      <Transparency info={engine.info} onBack={() => setFlow(null)} />
    ) : section === "backup" ? (
      <Backup
        scan={scan}
        scanning={scanning}
        selectionLabel={scanLabel}
        engineError={engine.error}
        auth={auth}
        currentJob={jobs.job}
        recoveredCount={jobs.recovered.length}
        onChooseFolder={() => void chooseFolder()}
        onChooseFiles={() => void chooseFiles()}
        onReview={() => setFlow({ kind: "review" })}
        onConnect={() => openConnect(null)}
        onActivity={() => goSection("activity")}
        onTransparency={() => setFlow({ kind: "transparency" })}
        onRetryEngine={() => void engine.refresh()}
      />
    ) : section === "activity" ? (
      <Activity
        jobs={jobs}
        onOpenJob={(jobId) => void openJob(jobId)}
        onCloseJob={() => jobs.closeJob()}
        onCancel={() => void jobs.cancel()}
        onRetry={retryJob}
        onResume={resumeJob}
        onReconnect={() => openConnect(null)}
        onChooseFolder={() => void chooseFolder()}
      />
    ) : (
      <Settings
        engine={engine}
        auth={auth}
        onConnect={() => openConnect(null)}
        onTransparency={() => setFlow({ kind: "transparency" })}
        onClearHistory={clearHistory}
      />
    );

  return (
    <div className="grain relative flex h-full overflow-hidden bg-ink-950 font-sans text-stone-200">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-72 prism-light opacity-60" />

      <aside className="relative z-10 flex w-[236px] shrink-0 flex-col border-r border-white/[0.06] bg-ink-900/70 backdrop-blur-xl">
        <div className="flex h-16 items-center gap-2.5 px-5">
          <BrandMark className="size-8 text-photon-400" />
          <div className="leading-none">
            <p className="text-[17px] font-semibold tracking-[-0.01em] text-stone-50">
              Photonic
            </p>
            <p className="mt-1 text-[11px] font-medium uppercase tracking-[0.16em] text-stone-600">
              Photo backup
            </p>
          </div>
        </div>

        <nav className="mt-3 space-y-0.5 px-3" aria-label="Main">
          {NAV.map((item) => {
            const active = section === item.id && !flow;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => goSection(item.id)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex w-full cursor-pointer items-center gap-3 rounded-[9px] px-2.5 py-2.5 text-[14px] font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-photon-400",
                  active
                    ? "bg-white/[0.055] text-stone-100"
                    : "text-stone-500 hover:bg-white/[0.03] hover:text-stone-300",
                )}
              >
                {active && (
                  <span
                    aria-hidden="true"
                    className="absolute left-0 top-1/2 h-4 w-px -translate-y-1/2 bg-photon-400"
                  />
                )}
                <item.icon
                  className={cn(
                    "size-[18px]",
                    active ? "text-photon-400" : "text-stone-600",
                  )}
                  strokeWidth={1.7}
                />
                {item.label}
              </button>
            );
          })}
        </nav>

        <div className="mt-auto space-y-3 p-3">
          <div className="px-2">
            {auth.status?.connected ? (
              <>
                <StatusDot
                  tone={authExpired ? "warn" : "good"}
                  label={
                    authExpired
                      ? "Sign-in expired"
                      : (auth.status.emailMasked ?? "Connected")
                  }
                />
                <button
                  type="button"
                  onClick={() => openConnect(null)}
                  className="mt-1.5 cursor-pointer text-[12px] text-stone-500 transition hover:text-stone-300"
                >
                  Manage connection
                </button>
              </>
            ) : (
              <Button
                variant="secondary"
                size="sm"
                className="w-full"
                onClick={() => openConnect(null)}
              >
                Connect Google Photos
              </Button>
            )}
          </div>
          <button
            type="button"
            onClick={() => setFlow({ kind: "transparency" })}
            className="w-full cursor-pointer px-2 text-left text-[12px] leading-relaxed text-stone-600 transition hover:text-stone-400"
          >
            How Photonic works
          </button>
        </div>
      </aside>

      <div className="relative z-10 flex min-w-0 flex-1 flex-col">
        {notice &&
          notice !== dismissedNotice &&
          flow?.kind !== "connect" && (
            <AuthBanner
              notice={notice}
              emailMasked={auth.status?.emailMasked}
              onAction={() => {
                if (notice === "reconnected") goSection("activity");
                else openConnect(null);
              }}
              onDismiss={() => setDismissedNotice(notice)}
            />
          )}
        <main className="min-h-0 flex-1 overflow-y-auto">{flowContent}</main>
      </div>

      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-50 grid place-items-center bg-ink-950/75 backdrop-blur-sm">
          <div className="flex flex-col items-center rounded-[20px] border border-photon-400/25 bg-ink-900/80 px-16 py-12 text-center shadow-2xl">
            <BrandMark className="size-10 text-photon-400" />
            <p className="mt-4 font-display text-2xl text-stone-100">
              Drop folders or photos
            </p>
            <p className="mt-1 text-sm text-stone-500">
              Nothing uploads until you review.
            </p>
          </div>
        </div>
      )}

      {toast && (
        <Toast
          message={toast.message}
          tone={toast.tone}
          onDismiss={dismissToast}
        />
      )}
    </div>
  );
}

export default App;
