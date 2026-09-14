import type { FieldedRow, RoundLineup as RoundLineupData } from "@/lib/db/queries";
import { formatLeagueMoment } from "@/lib/domain/clock";
import { Pitch, type PitchLine } from "./pitch";

/**
 * Keeper first, then outward from goal to attack — the order a pitch is read in, not
 * the order rows happen to arrive in. See `LINE_ORDER` in `queries.ts`, which sorts
 * `loadRoundLineup`'s eleven the same way for the same reason.
 */
const LINES = ["goalkeeper", "defender", "midfield", "striker"] as const;

/**
 * What a manager fielded in one round — read, not chosen: no state, no search, a server
 * component like `SquadList` and `OpportunityBoard`.
 *
 * The pitch itself now lives in `./pitch`: this component's spec always said a shared
 * pitch was "worth doing when a third caller appears, and not before", and
 * `LineupBoard`'s best eleven is that caller. What stays here is narrower — turn a
 * round's `FieldedRow`s into what `Pitch` wants (a figure already formatted as this
 * round's points, one `★` mark for the round's ideal eleven) and write the caption that
 * explains that one mark, aggregated, once.
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

  // All four lines, always, even the empty ones — see `Pitch`'s own doc comment for why:
  // a 5-4-1 and a 3-4-3 need to be told apart at a glance rather than by the label.
  const lines: PitchLine[] = LINES.map((line) => ({
    line,
    players: byLine[line].map((player) => ({
      id: player.playerId,
      nickname: player.nickname,
      imageUrl: player.imageUrl,
      figure: String(player.weekPoints),
      marks: player.inIdeal
        ? [{ symbol: "★", label: "Made the round's ideal eleven" }]
        : [],
    })),
  }));

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

      <Pitch lines={lines} />

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
