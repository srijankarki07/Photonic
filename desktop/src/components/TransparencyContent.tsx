import { openPath, openUrl } from "@tauri-apps/plugin-opener";
import { Button } from "./ui";
import { Disclosure } from "./Disclosure";
import { CONSENT_VERSION } from "../lib/prefs";
import { TRANSPARENCY_SECTIONS } from "../content/transparency";
import type { EngineInfo } from "../lib/engine/types";

async function openSafely(path: string) {
  try {
    await openPath(path);
  } catch {
    // The path may not exist in a test/browser preview. The text still explains.
  }
}

export function TransparencyContent({
  info,
  showPaths = false,
}: {
  info?: EngineInfo | null;
  showPaths?: boolean;
}) {
  return (
    <div className="space-y-7">
      {TRANSPARENCY_SECTIONS.map((section) => (
        <section key={section.title}>
          <h3 className="text-[15px] font-semibold text-stone-100">
            {section.title}
          </h3>
          <p className="mt-1.5 text-sm leading-relaxed text-stone-400">
            {section.body}
          </p>
        </section>
      ))}

      <section>
        <h3 className="text-[15px] font-semibold text-stone-100">
          ReVanced and the sign-in key
        </h3>
        <p className="mt-1.5 text-sm leading-relaxed text-stone-400">
          The sign-in key comes from the modified Photos app (ReVanced) on your
          Android phone. Photonic never asks for your Google password. If you do
          not have ReVanced yet, its website explains the phone setup.
        </p>
        <div className="mt-3">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void openUrl("https://revanced.app")}
          >
            Open ReVanced website
          </Button>
        </div>
      </section>

      {showPaths && info && (
        <section>
          <h3 className="text-[15px] font-semibold text-stone-100">
            On this computer
          </h3>
          <p className="mt-1.5 text-sm leading-relaxed text-stone-400">
            Photonic keeps backup history in a local database and writes a
            redacted troubleshooting log. No media copies and no sign-in key are
            stored in either.
          </p>
          <div className="mt-3 divide-y divide-white/[0.06]">
            <PathRow
              label="Data folder"
              value={info.dataDir}
              onOpen={() => void openSafely(info.dataDir)}
            />
            <PathRow
              label="History database"
              value={info.databasePath}
              onOpen={() => void openSafely(info.dataDir)}
            />
            <PathRow
              label="Troubleshooting log"
              value={info.logFile}
              onOpen={() => void openSafely(info.logFile)}
            />
          </div>
        </section>
      )}

      <Disclosure title="Technical details">
        <p className="text-[13px] leading-relaxed text-stone-500">
          Photonic uses an unofficial mobile Google Photos upload path. The
          upload tool is open source (MIT). Photonic itself is local-only and
          does not operate a server. Explanation version {CONSENT_VERSION}.
          Google and ReVanced are trademarks of their respective owners.
        </p>
      </Disclosure>
    </div>
  );
}

function PathRow({
  label,
  value,
  onOpen,
}: {
  label: string;
  value: string;
  onOpen: () => void;
}) {
  return (
    <div className="flex items-center gap-3 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-stone-300">{label}</p>
        <p className="mt-0.5 truncate font-mono text-[12px] text-stone-600" title={value}>
          {value}
        </p>
      </div>
      <Button variant="ghost" size="sm" onClick={onOpen}>
        Open
      </Button>
    </div>
  );
}
