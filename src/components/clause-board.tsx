import Link from "next/link";
import type { ClauseRow } from "@/lib/domain/market";
import { formatMoney, type CatalogueRow } from "@/lib/domain/players";

/**
 * Who can be taken by clause, and who frees up next.
 *
 * The league gives a bought player fourteen days nobody can raid them in. The owner may
 * still sell by agreement — the lock stops a theft, not a trade — so this board answers
 * one question only: who is takeable, and when.
 *
 * Two groups, because they are two different questions. The takeable are ranked by market
 * value: they are all available now, so what separates them is which is worth having. The
 * locked are ranked by when they free up, because that group is a countdown and only its
 * top matters.
 *
 * A server component, like the other boards: no search, no pagination, nothing crosses.
 */

/** How many of each group to draw. The rest are counted, not listed. */
const ROWS = 10;

const madrid = (at: Date) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Madrid",
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(at);

/**
 * How long until a lock lifts, in the largest unit that stays honest.
 *
 * Hours below a day, because "in 1 day" for something happening in ninety minutes is the
 * difference between acting tonight and missing it.
 */
function countdown(until: Date, now: Date): string {
  const hours = Math.max(0, (until.getTime() - now.getTime()) / 3_600_000);
  if (hours < 1) return "under an hour";
  if (hours < 24) {
    const whole = Math.round(hours);
    return `${whole} ${whole === 1 ? "hour" : "hours"}`;
  }
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"}`;
}

function Row({
  row,
  player,
  owner,
  now,
}: {
  row: ClauseRow;
  player: CatalogueRow | undefined;
  owner: { teamId: string; name: string } | undefined;
  now: Date;
}) {
  return (
    <li
      className="grid grid-cols-[1fr_auto] items-baseline gap-3 border-b px-2 py-[6px]"
      style={{ borderColor: "var(--board-line)" }}
    >
      <span className="min-w-0 truncate text-[13px]">
        <Link
          href={`/players/${row.playerId}`}
          className="underline decoration-[var(--board-line)] underline-offset-4"
        >
          {player?.nickname ?? row.playerId}
        </Link>
        <span className="ml-2 text-[10.5px]" style={{ color: "var(--board-ink-dim)" }}>
          {player?.position}
          {owner === undefined ? null : (
            <>
              {" · "}
              <Link href={`/teams/${owner.teamId}`} className="underline underline-offset-4">
                {owner.name}
              </Link>
            </>
          )}
        </span>
      </span>

      <span className="text-right text-[12px] tabular-nums" style={{ fontFamily: "var(--font-mono)" }}>
        {/* Market value, and labelled as nothing else. The clause price is a function of it
            that this portal does not know, so printing one would be inventing a figure on
            the screen most likely to be acted on. */}
        {player?.currentValue == null ? "—" : formatMoney(player.currentValue)}
        {row.protectedUntil === null ? null : (
          <span className="block text-[10px]" style={{ color: "var(--board-ink-dim)" }}>
            {countdown(row.protectedUntil, now)}
          </span>
        )}
      </span>
    </li>
  );
}

export function ClauseBoard({
  board,
  players,
  owners,
  now,
  logBegan,
}: {
  board: ClauseRow[];
  players: Map<string, CatalogueRow>;
  /** Manager id to their team id and name, so a row can name and link the current owner. */
  owners: Map<number, { teamId: string; name: string }>;
  now: Date;
  /** When the market log starts reaching. Null before anything has been captured. */
  logBegan: Date | null;
}) {
  if (board.length === 0) {
    return (
      <p className="mt-3 text-[13px]" style={{ color: "var(--board-ink-dim)" }}>
        No squad has been read yet, so nobody can be said to hold anyone.
      </p>
    );
  }

  const free = board
    .filter((row) => row.protectedUntil === null)
    // All available now, so what separates them is which is worth taking.
    .sort(
      (a, b) =>
        (players.get(b.playerId)?.currentValue ?? -1) -
          (players.get(a.playerId)?.currentValue ?? -1) ||
        (players.get(a.playerId)?.nickname ?? "").localeCompare(
          players.get(b.playerId)?.nickname ?? "",
        ),
    );
  const locked = board.filter((row) => row.protectedUntil !== null);

  const group = (rows: ClauseRow[]) =>
    rows.slice(0, ROWS).map((row) => (
      <Row
        key={`${row.managerId}:${row.playerId}`}
        row={row}
        player={players.get(row.playerId)}
        owner={owners.get(row.managerId)}
        now={now}
      />
    ));

  const more = (rows: ClauseRow[]) =>
    rows.length <= ROWS ? null : (
      <p className="mt-1 px-2 text-[10.5px]" style={{ color: "var(--board-ink-dim)" }}>
        and {rows.length - ROWS} more
      </p>
    );

  return (
    <>
      <h3 className="mt-4 text-[11px] uppercase tracking-[0.06em]" style={{ color: "var(--board-gain)" }}>
        Takeable now · {free.length}
      </h3>
      {free.length === 0 ? (
        <p className="mt-2 text-[13px]" style={{ color: "var(--board-ink-dim)" }}>
          Every held player is inside their fourteen days.
        </p>
      ) : (
        <>
          <p className="mt-1 px-2 text-[10px]" style={{ color: "var(--board-ink-dim)" }}>
            dearest first
          </p>
          <ul className="border-t" style={{ borderColor: "var(--board-line)" }}>
            {group(free)}
          </ul>
          {more(free)}
        </>
      )}

      <h3 className="mt-6 text-[11px] uppercase tracking-[0.06em]" style={{ color: "var(--board-ink-dim)" }}>
        Freeing up next · {locked.length} locked
      </h3>
      {locked.length === 0 ? (
        <p className="mt-2 text-[13px]" style={{ color: "var(--board-ink-dim)" }}>
          Nobody is protected.
        </p>
      ) : (
        <>
          <ul className="mt-1 border-t" style={{ borderColor: "var(--board-line)" }}>
            {group(locked)}
          </ul>
          {more(locked)}
          <p className="mt-2 px-2 text-[10px]" style={{ color: "var(--board-ink-dim)" }}>
            first lifts {madrid(locked[0].protectedUntil as Date)}
          </p>
        </>
      )}

      {/* The one thing that could make this board wrong, said where it is acted on. */}
      <p className="mt-4 text-[10.5px]" style={{ color: "var(--board-ink-dim)" }}>
        A player the log never saw arrive is read as takeable, which is sound only while the
        log reaches back further than the fourteen days
        {logBegan === null ? "" : ` — it starts ${logBegan.toISOString().slice(0, 10)}`}. A
        week-long gap in the sweep could hide an acquisition and show a locked player as
        free.
      </p>
    </>
  );
}
