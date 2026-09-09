"use client";

import { useState, useTransition } from "react";
import { MAX_VOTES } from "@/lib/domain/necroporra";

type VoteResult = { ok: boolean; message: string };
type VoteAction = (formData: FormData) => Promise<VoteResult>;

export type BallotTeam = { id: string; managerName: string };

/**
 * The form: pick up to two teams to finish this round last.
 *
 * A client component for the same reason `ClaimList` is one: a server action wired
 * straight to `action={...}` throws its return value away, so the outcome sentence would
 * never reach the reader. `useState` holds the last result, `useTransition` the pending
 * state in between.
 *
 * The selection is held here rather than left to the checkboxes so the control can say
 * "2 of 2 picked" and refuse a third before a round trip. That is a courtesy and not a
 * control — the action re-checks every rule against the world as it is, because a form
 * left open in a tab outlives its round.
 */
export function NecroporraBallot({
  gameweek,
  teams,
  chosen,
  action,
}: {
  gameweek: number;
  teams: BallotTeam[];
  chosen: string[];
  action: VoteAction;
}) {
  const [picks, setPicks] = useState<string[]>(chosen);
  const [result, setResult] = useState<VoteResult | null>(null);
  const [pending, startTransition] = useTransition();

  const toggle = (id: string) =>
    setPicks((current) =>
      current.includes(id)
        ? current.filter((pick) => pick !== id)
        : // Drops the OLDEST pick rather than refusing the tap. On a phone, a disabled
          // third checkbox reads as a broken control; replacing the first pick is what
          // the reader meant by tapping a third team.
          [...current, id].slice(-MAX_VOTES),
    );

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData();
        formData.set("gameweek", String(gameweek));
        for (const id of picks) formData.append("teamId", id);
        startTransition(async () => setResult(await action(formData)));
      }}
    >
      <div className="mt-3 border-t" style={{ borderColor: "var(--board-line)" }}>
        {teams.map((team) => {
          const picked = picks.includes(team.id);
          return (
            <label
              key={team.id}
              className="flex cursor-pointer items-center gap-3 border-b px-2 py-[7px] text-[13px]"
              style={{
                borderColor: "var(--board-line)",
                background: picked
                  ? "color-mix(in srgb, var(--board-you) 10%, transparent)"
                  : undefined,
              }}
            >
              <input
                type="checkbox"
                name="teamId"
                value={team.id}
                checked={picked}
                onChange={() => toggle(team.id)}
                className="accent-[var(--board-you)]"
              />
              <span>{team.managerName}</span>
            </label>
          );
        })}
      </div>

      <div className="mt-3 flex items-center gap-3">
        <button
          type="submit"
          disabled={pending || picks.length === 0}
          className="board-button board-button-primary disabled:opacity-40"
        >
          {pending ? "Saving…" : "Save my picks"}
        </button>
        <span className="text-[11px] tabular-nums" style={{ color: "var(--board-ink-dim)" }}>
          {picks.length} of {MAX_VOTES} picked
        </span>
      </div>

      {result ? (
        <p
          className="mt-3 text-[12px]"
          style={{ color: result.ok ? "var(--board-gain)" : "var(--board-alert)" }}
        >
          {result.message}
        </p>
      ) : null}
    </form>
  );
}
