"use client";

import { useRouter } from "next/navigation";

/**
 * Choosing between the season's table and one round's.
 *
 * A `<select>`, not a row of pills: a season is 38 rounds, and thirty-eight pills is the
 * wall the catalogue was redesigned to stop being. It also has to work at 320px, where a
 * select is one control and a pill row is a horizontal scroll a reader has to discover.
 *
 * The choice goes into the URL rather than into state, so a round is linkable — "look at
 * round 3" in the group chat is a link — and the back button works. The season is the
 * empty value because it is the default the page opens on.
 *
 * Newest round first, under the season total. By May the list is 38 entries and the one
 * anybody wants is the one just played; ascending would put it at the bottom, behind a
 * scroll, every week for nine months. The caller passes rounds oldest-first because that
 * is what "rounds played" means everywhere else in the page — the reversal is a display
 * decision and belongs here, not in a shared array the form bars also read.
 */
export function RoundPicker({
  gameweeks,
  selected,
  basePath = "/standings",
  param = "round",
  allLabel = "Season total",
  legend = "Showing",
}: {
  gameweeks: number[];
  selected: number | null;
  /** Where the choice navigates. Two mounts: the standings and the Necroporra. */
  basePath?: string;
  param?: string;
  /**
   * The label for "no particular round". Pass null where every choice IS a round — the
   * Necroporra always shows one — so the select has no option that means nothing.
   */
  allLabel?: string | null;
  legend?: string;
}) {
  const router = useRouter();

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
        value={selected === null ? "" : String(selected)}
        onChange={(event) => {
          const round = event.target.value;
          router.push(round === "" ? basePath : `${basePath}?${param}=${round}`);
        }}
      >
        {allLabel === null ? null : <option value="">{allLabel}</option>}
        {[...gameweeks].reverse().map((week) => (
          <option key={week} value={week}>
            Round {week}
          </option>
        ))}
      </select>
    </label>
  );
}
