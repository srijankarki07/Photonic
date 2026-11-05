const KEY = "photonic.preferences.v1";
export const CONSENT_VERSION = 1;

export interface Preferences {
  consentVersion: number;
  acceptedAt: string | null;
  onboardingSeen: boolean;
}

const DEFAULTS: Preferences = {
  consentVersion: 0,
  acceptedAt: null,
  onboardingSeen: false,
};

export function loadPreferences(): Preferences {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<Preferences>;
    return {
      consentVersion:
        typeof parsed.consentVersion === "number" ? parsed.consentVersion : 0,
      acceptedAt:
        typeof parsed.acceptedAt === "string" ? parsed.acceptedAt : null,
      onboardingSeen: Boolean(parsed.onboardingSeen),
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function savePreferences(patch: Partial<Preferences>): Preferences {
  const next = { ...loadPreferences(), ...patch };
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // A read-only/private webview still works; consent is re-asked next launch.
  }
  return next;
}

export function needsConsent(preferences: Preferences): boolean {
  return preferences.consentVersion < CONSENT_VERSION;
}
