"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { urlWithParam } from "./picker-url";

export type PickableTeam = { id: string; name: string };

/**
 * Whose votes are being read.
 *
 * The same control as `RoundPicker`, pointed at people instead of rounds, and for the
 * same reasons: one `<select>` works at 320px where thirteen pills are a horizontal
 * scroll nobody discovers, and the choice lives in the URL so "look at Chus's haters" is
 * a link somebody can paste into the group chat.
 *
 * Alphabetical, because row order out of the database is undefined and these are names
 * rather than a sequence — there is no "latest manager" the way there is a latest round.
 *
 * The empty option is a PROMPT and disappears once anybody is chosen. It is only ever
 * seen by a reader with no claimed team: everybody else opens on their own boards, so
 * "no manager" is not a state they can navigate back to.
 */
export function TeamPicker({
  teams,
  selected,
  basePath,
  param = "manager",
  legend = "Manager",
}: {
  teams: PickableTeam[];
  /** Whose boards are on screen, or null for a reader who has not chosen and has no claim. */
  selected: string | null;
  basePath: string;
  param?: string;
  legend?: string;
}) {
  const router = useRouter();
  const current = useSearchParams();

  return (
    <label className="flex items-center gap-2 text-[11px]" style={{ color: "var(--board-ink-dim)" }}>
      <span className="uppercase tracking-[0.06em]">{legend}</span>
      <select
        className="border px-2 py-[3px] text-[12px]"
        style={{
          fontFamily: "var(--font-mono)",
          background: "var(--board-panel)",
          borderColor: "var(--board-line)",
          color: "var(--board-ink)",
        }}
        value={selected ?? ""}
        onChange={(event) => {
          // `scroll: false` for the reason the round picker gives: these boards sit well
          // down the page, and the default scroll-to-top would throw the reader away from
          // the thing they just changed.
          router.push(urlWithParam(basePath, current, param, event.target.value), {
            scroll: false,
          });
        }}
      >
        {selected === null ? <option value="">Pick a manager</option> : null}
        {/* Copied before sorting: `sort` is in place, and the page hands over the same
            array it draws the ballot form from. */}
        {[...teams]
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((team) => (
            <option key={team.id} value={team.id}>
              {team.name}
            </option>
          ))}
      </select>
    </label>
  );
}
