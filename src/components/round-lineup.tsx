import Image from "next/image";
import type { FieldedRow, RoundLineup as RoundLineupData } from "@/lib/db/queries";
import { formatLeagueMoment } from "@/lib/domain/clock";

/**
 * Keeper first, then outward from goal to attack — the order a pitch is read in, not
 * the order rows happen to arrive in. See `LINE_ORDER` in `queries.ts`, which sorts
 * `loadRoundLineup`'s eleven the same way for the same reason.
 */
const LINES = ["goalkeeper", "defender", "midfield", "striker"] as const;

/**
 * One player on the grass: their portrait, their name, what they scored.
 *
 * The portrait is the same one `/players/[id]` draws, from the API's own assets host — it
 * has been sending them all along. `alt=""` because the name is right underneath: an image
 * announced as "Courtois" above the word Courtois is the same fact twice.
 *
 * A player the API has never pictured gets their initials in the same circle rather than a
 * hole in the eleven, which would read as a missing player instead of a missing photo.
 */
function OnThePitch({ player }: { player: FieldedRow }) {
  const initials = player.nickname
    .split(/[\s.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <li className="flex min-w-0 flex-col items-center gap-1" style={{ width: "19%" }}>
      <span
        className="block h-8 w-8 shrink-0 overflow-hidden rounded-full border"
        style={{ borderColor: "var(--board-line)", background: "var(--board-panel)" }}
      >
        {player.imageUrl === null ? (
          <span
            className="flex h-full w-full items-center justify-center text-[9px]"
            style={{ color: "var(--board-ink-dim)" }}
          >
            {initials}
          </span>
        ) : (
          <Image
            src={player.imageUrl}
            alt=""
            width={32}
            height={32}
            // The source is 256×256; at 32 CSS pixels the optimizer is asked for 64 as
            // well, for retina, and never upscales. Eleven of these to a round.
            className="block h-8 w-8 object-cover"
          />
        )}
      </span>

      <span className="block w-full truncate text-center text-[10px]" title={player.nickname}>
        {player.nickname}
        {/* The shape half of "a shape and a word": the caption below the pitch says the
            word once, aggregated, and cannot say WHICH row it belongs to — so this mark
            carries its own accessible name, exactly as `HoldIcon` does on `SquadList`. */}
        {player.inIdeal ? (
          <span role="img" aria-label="Made the round's ideal eleven">
            {" "}★
          </span>
        ) : null}
      </span>

      <span
        className="block text-[10px] tabular-nums"
        style={{ fontFamily: "var(--font-mono)", color: "var(--board-ink-dim)" }}
      >
        {player.weekPoints}
      </span>
    </li>
  );
}

/** One line of the eleven, spread across the pitch the way it stands on it. */
function Line({ line, players }: { line: (typeof LINES)[number]; players: FieldedRow[] }) {
  return (
    <div data-line={line} className="py-2">
      <ul className="flex flex-wrap items-start justify-evenly gap-x-1 gap-y-2">
        {players.map((player) => (
          <OnThePitch key={player.playerId} player={player} />
        ))}
      </ul>
    </div>
  );
}

/**
 * What a manager fielded in one round — read, not chosen: no state, no search, a server
 * component like `SquadList` and `OpportunityBoard`.
 *
 * The layout is the point: a lineup is read as a shape before it is read as a list, so
 * this draws one LINE PER ROW on a portrait pitch, the keeper at the foot of it and the
 * attack running up — the way every fantasy game draws an eleven. All four rows are
 * always drawn, including one with nobody in it, so a 5-4-1 and a 3-4-3 can be told
 * apart at a glance instead of by reading the formation label.
 *
 * Each player is a fifth of the width, so a five-man line fits across a phone without the
 * row wrapping and without a horizontal scroll; the names `truncate` inside that width
 * rather than pushing their neighbours out of line.
 */
export function RoundLineup({ lineup }: { lineup: RoundLineupData | null }) {
  if (lineup === null) {
    return (
      <p className="mt-3 text-[13px]" style={{ color: "var(--board-ink-dim)" }}>
        No lineup is stored for this round.
      </p>
    );
  }

  const byLine: Record<(typeof LINES)[number], FieldedRow[]> = {
    goalkeeper: [],
    defender: [],
    midfield: [],
    striker: [],
  };
  for (const player of lineup.players) {
    const line = player.line as (typeof LINES)[number];
    (byLine[line] ?? byLine.striker).push(player);
  }

  const idealCount = lineup.players.filter((player) => player.inIdeal).length;

  return (
    <div className="mt-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[15px] font-medium" style={{ fontFamily: "var(--font-mono)" }}>
          {lineup.formation}
        </span>
        <span
          className="text-[13px] tabular-nums"
          style={{ fontFamily: "var(--font-mono)", color: "var(--board-ink-dim)" }}
        >
          {lineup.points} pts
        </span>
      </div>

      {/* `flex-col-reverse`, and it is deliberate: the lines are written keeper-first in
          the DOM — the order the data has, the order a screen reader should hear, and the
          order `LINE_ORDER` sorts them in — while the pitch shows the keeper at the FOOT
          of it with the attack running up the screen, which is how every fantasy game
          draws an eleven and how the owner asked for it. */}
      <div
        className="mt-3 flex flex-col-reverse overflow-hidden border px-1 py-2"
        style={{
          borderColor: "var(--board-line)",
          background: "var(--board-panel) url(/pitch.svg) center / 100% 100% no-repeat",
        }}
      >
        {LINES.map((line) => (
          <Line key={line} line={line} players={byLine[line]} />
        ))}
      </div>

      <p className="mt-2 text-[10.5px]" style={{ color: "var(--board-ink-dim)" }}>
        Frozen {formatLeagueMoment(lineup.snapshotTookOn)}
        {idealCount === 0 ? null : (
          <>
            {" "}
            · ★ made the round&rsquo;s ideal eleven ({idealCount})
          </>
        )}
      </p>
    </div>
  );
}
