/**
 * Kept out of `sync-controls.tsx` on purpose: that file imports the server actions
 * from `./actions`, which load `@/lib/db` and validate every environment variable at
 * module load. A plain function testable with no environment variables belongs in a
 * module that does not drag that in — the same reason `credential-state.ts` is its
 * own file rather than living inside `sync-controls.tsx` or `page.tsx`.
 */
export type Busy = "credential" | "sync" | "sweep" | null;

/**
 * Two actions share one `useTransition` in `SyncControls`, and its `pending` flag is
 * one boolean for BOTH of them — that is exactly what made pressing "Sweep players"
 * relabel the OTHER button to "Syncing…" while no sync was running (Important 10).
 * `busy` names which action a click actually started; a button's own label only
 * changes when `pending` is true AND `busy` names that button's own action, so the
 * idle button stays idle no matter which one is running.
 */
export function buttonLabel(action: "sync" | "sweep", pending: boolean, busy: Busy): string {
  const running = pending && busy === action;
  if (action === "sync") return running ? "Syncing…" : "Sync now";
  return running ? "Working…" : "Sweep players";
}
