import { desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { syncRuns } from "@/lib/db/schema";
import { hasStoredCredential } from "@/lib/fantasy-client/credentials";
import { requirePermission } from "@/lib/auth/guards";
import { SyncControls } from "./sync-controls";
import { CREDENTIAL_RECOVERY_MESSAGE, isCredentialFailure } from "./credential-state";

export default async function SyncPage() {
  await requirePermission({ sync: ["trigger"] });

  // Presence, not readability. This is the one screen that can re-bootstrap a
  // credential, so it must not decrypt one: a rotated `CREDENTIALS_KEY` would take
  // down the page that fixes a rotated `CREDENTIALS_KEY`.
  const [hasCredential, runs] = await Promise.all([
    hasStoredCredential(db),
    db.select().from(syncRuns).orderBy(desc(syncRuns.startedAt)).limit(10),
  ]);

  const credentialFailed = runs.some((run) => isCredentialFailure(run.error));

  return (
    <section className="max-w-3xl">
      <h1 className="text-xl font-semibold">Sync</h1>
      <p className="mt-2" style={{ color: "var(--board-ink-dim)" }}>
        {hasCredential
          ? "A LaLiga credential is stored. Syncs run on their own; trigger one here to check."
          : "No LaLiga credential is stored yet, so nothing can sync. Paste a bootstrap refresh token below."}
      </p>

      {credentialFailed && (
        <p role="alert" className="mt-4 text-sm" style={{ color: "var(--board-alert)" }}>
          {CREDENTIAL_RECOVERY_MESSAGE}
        </p>
      )}

      <SyncControls hasCredential={hasCredential} />

      <h2 className="mt-10 text-lg font-semibold">Recent runs</h2>
      {runs.length === 0 ? (
        <p className="mt-2" style={{ color: "var(--board-ink-dim)" }}>No sync has run yet.</p>
      ) : (
        <table className="mt-3 w-full text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="py-2">Started</th><th>Trigger</th><th>Status</th>
              <th>Gameweeks</th><th>Error</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <tr key={run.id} className="border-b">
                <td className="py-2">{run.startedAt.toISOString()}</td>
                <td>{run.trigger}</td>
                <td>{run.status}</td>
                <td>{run.weeksSynced ?? "—"}</td>
                <td style={{ color: "var(--board-ink-dim)" }}>
                  {isCredentialFailure(run.error) ? (
                    <span style={{ color: "var(--board-alert)" }}>
                      The credential needs re-bootstrapping — see the note above
                    </span>
                  ) : (
                    (run.error ?? "")
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
