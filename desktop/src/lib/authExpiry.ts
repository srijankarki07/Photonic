import type { AuthStatus } from "./engine/types";

export type AuthNotice = "expired" | "needs_auth" | "reconnected";

/** Photonic treats a saved sign-in as valid for ~24 hours. */
export function isAuthExpired(
  status: AuthStatus | null,
  nowSeconds: number = Date.now() / 1000,
): boolean {
  return Boolean(
    status?.connected &&
      status.expiresAt != null &&
      status.expiresAt <= nowSeconds,
  );
}

/**
 * Which connection banner to show, if any.
 *
 * - `expired`: the saved sign-in is past its expected lifetime.
 * - `needs_auth`: a job failed for lack of a valid connection.
 * - `reconnected`: the connection is valid again but a stopped job still
 *   needs to be resumed from Activity.
 */
export function authNotice(
  status: AuthStatus | null,
  needsAuth: boolean,
  nowSeconds: number = Date.now() / 1000,
): AuthNotice | null {
  if (isAuthExpired(status, nowSeconds)) return "expired";
  if (needsAuth) {
    return status?.connected ? "reconnected" : "needs_auth";
  }
  return null;
}
