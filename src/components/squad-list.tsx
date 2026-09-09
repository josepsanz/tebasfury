import Link from "next/link";
import { clubOrPosition, formatMoney, statusLabel, type SquadGroup } from "@/lib/domain/players";
import { ClauseName, ClauseNote } from "@/components/clause-marks";
import { HoldIcon } from "@/components/hold-icon";
import { formatLeagueMoment } from "@/lib/domain/clock";
import type { ClauseStatus } from "@/lib/domain/market";

/**
 * What a manager currently holds, grouped by position.
 *
 * Current state, not history: this is `squad_members` as the last sweep read it, and the
 * market log on the same page is the story of how it got that way. The two answer
 * different questions and neither is derivable from the other — the log reaches back only
 * to the first sweep, and a squad has players who arrived before that.
 *
 * A server component, like `OpportunityBoard` and for the same reason: no search, no
 * pills, no pagination, so none of these rows cross to the browser.
 */
export function SquadList({
  groups,
  total,
  ownershipKnown,
  clauses,
  holds,
}: {
  groups: SquadGroup[];
  total: number | null;
  /** False before any squad has been read at all — see `CatalogueData.ownershipKnown`. */
  ownershipKnown: boolean;
  /**
   * Player id to their clause state, in the same shape and drawn with the same marks as
   * the catalogue's — see `ClauseName`. A squad is read for exactly the reason the
   * catalogue is, so it says it the same way rather than inventing an owner-side
   * vocabulary that would have to be learnt twice.
   *
   * Optional, so a caller that has not worked it out shows the squad without colouring a
   * single name — no marks is a fair thing to say when nothing is known.
   */
  clauses?: Record<string, ClauseStatus>;
  /**
   * Player id to when their five-day fair-play hold lifts. Absent means it already has.
   *
   * A squad page's own question, which is why it is a separate prop rather than another
   * field on the clause state: the catalogue asks whether a player can be TAKEN, and this
   * asks whether their owner can SELL. Only one page has a reason to draw it.
   */
  holds?: Record<string, Date>;
}) {
  if (!ownershipKnown) {
    return (
      <p className="mt-3 text-[13px]" style={{ color: "var(--board-ink-dim)" }}>
        No squad has been read yet, so nobody can be said to hold anyone. The next sweep
        settles it.
      </p>
    );
  }

  if (groups.length === 0) {
    return (
      <p className="mt-3 text-[13px]" style={{ color: "var(--board-ink-dim)" }}>
        No players recorded for this manager.
      </p>
    );
  }

  const count = groups.reduce((sum, group) => sum + group.players.length, 0);
  const held = groups.reduce(
    (sum, group) => sum + group.players.filter((player) => holds?.[player.id]).length,
    0,
  );

  return (
    <>
      <p className="mt-2 text-[10.5px]" style={{ color: "var(--board-ink-dim)" }}>
        {count} {count === 1 ? "player" : "players"} ·{" "}
        {/* "at today's values" is not padding. The home page's own "Squad value" is the
            figure the API reported at the last settled gameweek; this is the sum of each
            player's latest snapshot. The two legitimately differ — by 13M for one manager
            the day this shipped — and a reader comparing them deserves to know which is
            which rather than suspecting a bug.

            Unknown, not a partial sum, when a player has no price: a total that quietly
            omits one reads as the squad being cheaper than it is. */}
        {total === null
          ? "value not fully recorded"
          : `${formatMoney(total)} at today's values`}
      </p>

      <div className="mt-2 border-t" style={{ borderColor: "var(--board-line)" }}>
        {groups.map((group) => (
          <div key={group.position}>
            <div
              className="flex items-baseline justify-between gap-2 px-2 py-[4px] text-[10px] uppercase tracking-[0.06em]"
              style={{ background: "var(--board-panel)", color: "var(--board-ink-dim)" }}
            >
              <span>
                {group.position} · {group.players.length}
              </span>
              <span className="tabular-nums" style={{ fontFamily: "var(--font-mono)" }}>
                {group.value === null ? "—" : formatMoney(group.value)}
              </span>
            </div>

            <ul>
              {group.players.map((player) => {
                const label = statusLabel(player.status);
                const clause = clauses?.[player.id];
                const hold = holds?.[player.id];
                return (
                  <li
                    key={player.id}
                    className="grid grid-cols-[1fr_44px_84px] items-baseline gap-2 border-b px-2 py-[6px]"
                    style={{ borderColor: "var(--board-line)" }}
                  >
                    {/* Two lines, like the catalogue's rows: the name carries the colour
                        and the marks, and everything qualifying it drops to a dim line
                        beneath. It was one line before the clause arrived, and keeping it
                        one would have put a padlock inside a truncating span — the exact
                        bug this codebase has already fixed once. */}
                    <span className="min-w-0">
                      <ClauseName
                        clause={clause}
                        after={
                          hold === undefined ? undefined : (
                            <HoldIcon label={`Cannot be sold until ${formatLeagueMoment(hold)}`} />
                          )
                        }
                      >
                        <Link
                          href={`/players/${player.id}`}
                          className="underline decoration-[var(--board-line)] underline-offset-4"
                        >
                          {player.nickname}
                        </Link>
                      </ClauseName>
                      <span
                        className="block truncate text-[10.5px]"
                        style={{ color: "var(--board-ink-dim)" }}
                      >
                        {clubOrPosition(player)}
                        <ClauseNote clause={clause} />
                        {label === null ? null : (
                          <span style={{ color: "var(--board-alert)" }}> · {label}</span>
                        )}
                      </span>
                    </span>
                    <span
                      className="text-right text-[12px] tabular-nums"
                      style={{ fontFamily: "var(--font-mono)", color: "var(--board-ink-dim)" }}
                    >
                      {player.seasonPoints} pts
                    </span>
                    <span
                      className="text-right text-[12.5px] tabular-nums"
                      style={{ fontFamily: "var(--font-mono)" }}
                    >
                      {player.currentValue === null ? "—" : formatMoney(player.currentValue)}
                      {/* What it would cost to take them, beside what they are worth. The
                          two are not proportional — an owner can raise their own clause,
                          and across one captured squad the ratio ran from 1.00 to 7.15 —
                          so neither can be read off the other. */}
                      {player.buyoutClause === null ? null : (
                        <span
                          className="block text-[10px] tabular-nums"
                          style={{ color: "var(--board-ink-dim)" }}
                          title="Buyout clause"
                        >
                          clause {formatMoney(player.buyoutClause)}
                        </span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      {/* The hourglass explained once, under the list, rather than in a word beside every
          row it marks — which is what "only an icon" has to mean if it is to stay
          readable. Drawn only when the squad actually has one, so a manager with nothing
          held is not told about a rule that is not biting them. */}
      {held === 0 ? null : (
        <p
          className="mt-2 flex items-baseline gap-1.5 px-2 text-[10.5px]"
          style={{ color: "var(--board-ink-dim)" }}
        >
          <HoldIcon />
          <span>
            {held} {held === 1 ? "player was" : "players were"} signed less than five days
            ago and cannot be sold yet.
          </span>
        </p>
      )}
    </>
  );
}
