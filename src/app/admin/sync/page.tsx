import { desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { syncRuns } from "@/lib/db/schema";
import { loadRefreshToken } from "@/lib/fantasy-client/credentials";
import { requirePermission } from "@/lib/auth/guards";
import { SyncControls } from "./sync-controls";

export default async function SyncPage() {
  await requirePermission({ sync: ["trigger"] });

  const [credential, runs] = await Promise.all([
    loadRefreshToken(db),
    db.select().from(syncRuns).orderBy(desc(syncRuns.startedAt)).limit(10),
  ]);

  return (
    <section className="max-w-3xl">
      <h1 className="text-xl font-semibold">Sync</h1>
      <p className="mt-2 text-neutral-600">
        {credential
          ? "A LaLiga credential is stored. Syncs run on their own; trigger one here to check."
          : "No LaLiga credential is stored yet, so nothing can sync. Paste a bootstrap refresh token below."}
      </p>

      <SyncControls hasCredential={credential !== null} />

      <h2 className="mt-10 text-lg font-semibold">Recent runs</h2>
      {runs.length === 0 ? (
        <p className="mt-2 text-neutral-600">No sync has run yet.</p>
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
                <td className="text-neutral-600">{run.error ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
