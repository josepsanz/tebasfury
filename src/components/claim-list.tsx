"use client";

import { useState, useTransition } from "react";
import type { ClaimRow } from "@/lib/claims";
import { holdsATeam, rowState } from "@/lib/domain/claim-row";

type ClaimResult = { ok: boolean; message: string };
type ClaimAction = (formData: FormData) => Promise<ClaimResult>;

/**
 * The claim board: every manager's team, and the one control each row's state allows.
 *
 * A server action wired straight to `action={...}` throws its return value away, so
 * the outcome sentence — "Somebody claimed this team first" — would never reach the
 * reader. This follows `sync-controls.tsx`'s pattern instead: client component,
 * `useState` for the last result, `useTransition` for the pending state in between.
 *
 * `ClaimAction` is declared here, structurally, rather than imported from the server
 * action module Task 4 owns — this component must not depend on a module that does
 * not exist yet, and the shapes line up without a shared import.
 */
export function ClaimList({
  rows,
  viewerId,
  canReleaseAny,
  claimAction,
  releaseAction,
}: {
  rows: ClaimRow[];
  viewerId: string;
  canReleaseAny: boolean;
  claimAction: ClaimAction;
  releaseAction: ClaimAction;
}) {
  const [result, setResult] = useState<ClaimResult | null>(null);
  const [pending, startTransition] = useTransition();
  const taken = holdsATeam(rows, { userId: viewerId });

  // Losing a race is an ordinary outcome, not an exception: the action returns a
  // sentence, and the page it revalidates returns the world as it now is.
  const run = (action: ClaimAction, formData: FormData) =>
    startTransition(async () => setResult(await action(formData)));

  return (
    <>
      {result ? (
        <p
          role="status"
          className="mt-4 text-[11.5px]"
          style={{ color: result.ok ? "var(--board-ink-dim)" : "var(--board-alert)" }}
        >
          {result.message}
        </p>
      ) : null}

      {taken ? (
        <p className="mt-2 text-[11px]" style={{ color: "var(--board-ink-dim)" }}>
          It is one team per person. Release yours to pick a different one.
        </p>
      ) : null}

      <ul className="mt-4">
        {rows.map((row) => {
          const state = rowState(row, { userId: viewerId });
          return (
            <li
              key={row.teamId}
              className="flex items-center justify-between gap-3 border-b py-[11px]"
              style={{ borderColor: "var(--board-line)" }}
            >
              <span className="min-w-0 truncate text-[14.5px]">{row.managerName}</span>

              {state === "free" && !taken ? (
                <form action={(formData) => run(claimAction, formData)}>
                  <input type="hidden" name="teamId" value={row.teamId} />
                  <button
                    type="submit"
                    disabled={pending}
                    className="text-[11px] underline underline-offset-4"
                  >
                    This is me
                  </button>
                </form>
              ) : null}

              {state === "mine" ? (
                <form
                  action={(formData) => run(releaseAction, formData)}
                  className="flex items-center gap-3"
                >
                  <span className="text-[11px]" style={{ color: "var(--board-ink-dim)" }}>
                    Yours
                  </span>
                  <button
                    type="submit"
                    disabled={pending}
                    className="text-[11px] underline underline-offset-4"
                  >
                    Release
                  </button>
                </form>
              ) : null}

              {state === "taken" ? (
                <span className="flex items-center gap-3">
                  <span className="text-[11px]" style={{ color: "var(--board-ink-dim)" }}>
                    Claimed
                  </span>
                  {canReleaseAny ? (
                    <form action={(formData) => run(releaseAction, formData)}>
                      <input type="hidden" name="teamId" value={row.teamId} />
                      <button
                        type="submit"
                        disabled={pending}
                        className="text-[11px] underline underline-offset-4"
                      >
                        Release
                      </button>
                    </form>
                  ) : null}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </>
  );
}
