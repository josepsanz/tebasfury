import { CREDENTIAL_ERROR_NAME } from "@/lib/fantasy-client";

/**
 * What to tell an admin whose credential has stopped working.
 *
 * One text for both places it can surface — the result of pressing "Sync now", and a
 * scheduled run's entry in the history — because they are the same problem and have
 * the same fix. The four steps live in `docs/deployment.md`; they used to live only
 * in `spike/README.md`, a file that declares itself throwaway.
 */
export const CREDENTIAL_RECOVERY_MESSAGE =
  "The stored LaLiga credential no longer works, and nothing will sync until it is " +
  "replaced. Follow “Recovering the LaLiga credential” in docs/deployment.md: sign in " +
  "at miliga.laliga.com, capture a fresh refresh token from the network tab, and paste " +
  "it above.";

/**
 * Whether a recorded `sync_runs.error` is the credential state rather than an
 * ordinary failure.
 *
 * A scheduled run has no screen to branch in: all it leaves behind is that text, so
 * `runSync` records the error's name and this reads it back. Without it the history
 * printed `Unsupported state or unable to authenticate data` verbatim and the named
 * state existed only on the manual path.
 */
export function isCredentialFailure(error: string | null): boolean {
  return error !== null && error.startsWith(`${CREDENTIAL_ERROR_NAME}:`);
}
