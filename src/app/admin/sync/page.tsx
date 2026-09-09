import Link from "next/link";
import { desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { syncRuns } from "@/lib/db/schema";
import { loadLastPlayerSweep } from "@/lib/db/queries";
import { hasStoredCredential } from "@/lib/fantasy-client/credentials";
import { decideAccess, requirePermission } from "@/lib/auth/guards";
import { SyncControls } from "./sync-controls";
import { AccessList } from "./access-list";
import { loadAllowedEmailRows } from "@/lib/access";
import { getEnv } from "@/lib/env";
import { allowEmails, disallowEmail } from "./actions";
import { CREDENTIAL_RECOVERY_MESSAGE, isCredentialFailure } from "./credential-state";

export default async function SyncPage() {
  const session = await requirePermission({ sync: ["trigger"] });

  // Presence, not readability. This is the one screen that can re-bootstrap a
  // credential, so it must not decrypt one: a rotated `CREDENTIALS_KEY` would take
  // down the page that fixes a rotated `CREDENTIALS_KEY`.
  //
  // `lastPlayerSweep` is read here, not derived from `runs`: the standings chain can
  // log ten rows in under one busy weekend hour (see the doc comment on the query),
  // so a daily sweep's own row is almost never among the ten most recent runs. It is
  // the diagnostic `docs/deployment.md` step 8 actually depends on.
  const [hasCredential, runs, lastPlayerSweep, allowed] = await Promise.all([
    hasStoredCredential(db),
    db.select().from(syncRuns).orderBy(desc(syncRuns.startedAt)).limit(10),
    loadLastPlayerSweep(db),
    loadAllowedEmailRows(db),
  ]);

  // The page is reachable with `sync: ["trigger"]`, which a collaborator has; the list
  // needs `access: ["manage"]`, which only the admin has. So the section is hidden
  // rather than shown-and-refused — the actions check the same permission again anyway.
  const canManageAccess = decideAccess(session, { access: ["manage"] }).kind === "allow";

  // The banner stands only while nothing has synced since the credential broke.
  // `runs` is newest first, so the first run that either succeeded or failed on the
  // credential settles it: a success in between means someone has already fixed this.
  const decisive = runs.find(
    (run) => run.status === "succeeded" || isCredentialFailure(run.error),
  );
  const credentialFailed = decisive !== undefined && isCredentialFailure(decisive.error);

  return (
    <section className="max-w-3xl">
      <h1 className="text-xl font-semibold">Sync</h1>
      <p className="mt-2" style={{ color: "var(--board-ink-dim)" }}>
        {hasCredential
          ? "A LaLiga credential is stored. Standings sync every few minutes while a " +
            "round is live; players are swept once a day. Trigger either here to check."
          : "No LaLiga credential is stored yet, so nothing can sync. Paste a bootstrap refresh token below."}
      </p>

      {credentialFailed && (
        <p role="alert" className="mt-4 text-sm" style={{ color: "var(--board-alert)" }}>
          {CREDENTIAL_RECOVERY_MESSAGE}
        </p>
      )}

      <SyncControls hasCredential={hasCredential} lastPlayerSweep={lastPlayerSweep} />

      {canManageAccess ? (
        <>
          <h2 className="mt-10 text-lg font-semibold">Who may sign in</h2>
          <p className="mt-1 text-[12.5px]" style={{ color: "var(--board-ink-dim)" }}>
            Google does not gate this portal and cannot be made to, so this list is the
            only thing keeping the league private. Changes take effect on the next
            sign-in — no redeploy. Gmail dots are not interchangeable here: copy each
            address exactly as the person writes it.
          </p>
          <AccessList
            rows={allowed}
            adminEmail={getEnv().ADMIN_EMAIL}
            allow={allowEmails}
            disallow={disallowEmail}
          />
          {/* Being on the list is only half of it: a manager must also claim their team
              before they can be marked in the standings or vote in the Necroporra, and
              that second step is the one people skip. The claim board is also where
              whoever may correct league data can release a team somebody took by
              mistake — so it is the natural next screen from this one. */}
          <p className="mt-4 text-[12.5px]" style={{ color: "var(--board-ink-dim)" }}>
            Signing in is only half of it — each manager must also{" "}
            <Link href="/claim" className="underline underline-offset-4">
              claim their team
            </Link>{" "}
            before they can vote.
          </p>
        </>
      ) : null}

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
