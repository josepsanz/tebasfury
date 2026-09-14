import type { FieldedRow, RoundLineup as RoundLineupData } from "@/lib/db/queries";
import { formatLeagueMoment } from "@/lib/domain/clock";

/**
 * Keeper first, then outward from goal to attack — the order a pitch is read in, not
 * the order rows happen to arrive in. See `LINE_ORDER` in `queries.ts`, which sorts
 * `loadRoundLineup`'s eleven the same way for the same reason.
 */
const LINES = ["goalkeeper", "defender", "midfield", "striker"] as const;

const LINE_LABEL: Record<(typeof LINES)[number], string> = {
  goalkeeper: "GK",
  defender: "DEF",
  midfield: "MID",
  striker: "FWD",
};

/**
 * The pitch furniture: touchline, halfway line, centre circle, a goal box at the
 * keeper's end — drawn once, behind the columns, in `PitchIcon`'s own vocabulary
 * (hairlines, no fill) rather than as a photograph of grass. `preserveAspectRatio="none"`
 * lets the 100x100 viewBox stretch to whatever rectangle the grid actually draws, so the
 * halfway line and the goal box track the real column widths instead of a guess.
 *
 * Never green: this palette spends green on a gain and amber on the reader's own team,
 * and a field drawn in either would take one of those meanings away for decoration.
 */
function PitchFurniture() {
  return (
    <svg
      aria-hidden
      focusable="false"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      className="pointer-events-none absolute inset-0 h-full w-full"
      fill="none"
    >
      <line x1="50" y1="0" x2="50" y2="100" stroke="var(--board-line)" strokeWidth={0.6} />
      <ellipse cx="50" cy="50" rx="9" ry="18" stroke="var(--board-line)" strokeWidth={0.6} />
      <rect x="0.3" y="24" width="17" height="52" stroke="var(--board-line)" strokeWidth={0.6} />
    </svg>
  );
}

function Column({ line, players }: { line: (typeof LINES)[number]; players: FieldedRow[] }) {
  return (
    <div
      data-line={line}
      className="min-w-0 border-r px-1 py-2 last:border-r-0"
      style={{ borderColor: "var(--board-line)" }}
    >
      <div
        className="text-center text-[9px] uppercase tracking-[0.06em]"
        style={{ color: "var(--board-ink-dim)" }}
      >
        {LINE_LABEL[line]}
      </div>
      <ul className="mt-1.5 space-y-2">
        {players.map((player) => (
          <li key={player.playerId} className="min-w-0 text-center">
            <span className="block truncate text-[10.5px]" title={player.nickname}>
              {player.nickname}
              {/* The shape half of "a shape and a word" (I3): the word is the caption
                  below the pitch, said once rather than spelled out under every name —
                  the same trade `HoldIcon`'s caption already makes for the squad list. */}
              {player.inIdeal ? <span aria-hidden> ★</span> : null}
            </span>
            <span
              className="block text-[10px] tabular-nums"
              style={{ fontFamily: "var(--font-mono)", color: "var(--board-ink-dim)" }}
            >
              {player.weekPoints}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * What a manager fielded in one round — read, not chosen: no state, no search, a server
 * component like `SquadList` and `OpportunityBoard`.
 *
 * The layout is the point (I3): a lineup is read as a shape before it is read as a
 * list, so this draws one column per line, left to right, keeper first, over the pitch
 * furniture `PitchFurniture` sets out. All four columns are always drawn, including one
 * with nobody in it, so a 1-5-4-1 and a 1-3-4-3 can be told apart at a glance instead of
 * by reading the formation label.
 *
 * Column tracks are `minmax(0, ...)`, not bare `fr`: a bare fraction cannot shrink below
 * its content, which is exactly the horizontal scroll a phone-width reader must never get,
 * and `truncate` on a track that never shrinks does nothing.
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

      <div
        className="relative mt-3 overflow-hidden border"
        style={{ borderColor: "var(--board-line)", background: "var(--board-panel)" }}
      >
        <PitchFurniture />
        <div className="relative grid grid-cols-[minmax(0,0.7fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
          {LINES.map((line) => (
            <Column key={line} line={line} players={byLine[line]} />
          ))}
        </div>
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
