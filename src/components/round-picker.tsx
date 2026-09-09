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
 */
export function RoundPicker({
  gameweeks,
  selected,
}: {
  gameweeks: number[];
  selected: number | null;
}) {
  const router = useRouter();

  return (
    <label className="flex items-center gap-2 text-[11px]" style={{ color: "var(--board-ink-dim)" }}>
      <span className="uppercase tracking-[0.06em]">Showing</span>
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
          router.push(round === "" ? "/standings" : `/standings?round=${round}`);
        }}
      >
        <option value="">Season total</option>
        {gameweeks.map((week) => (
          <option key={week} value={week}>
            Round {week}
          </option>
        ))}
      </select>
    </label>
  );
}
