import Link from "next/link";
import { formatMoney, statusLabel, type SquadGroup } from "@/lib/domain/players";

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
}: {
  groups: SquadGroup[];
  total: number | null;
  /** False before any squad has been read at all — see `CatalogueData.ownershipKnown`. */
  ownershipKnown: boolean;
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
                return (
                  <li
                    key={player.id}
                    className="grid grid-cols-[1fr_46px_52px] items-baseline gap-2 border-b px-2 py-[6px]"
                    style={{ borderColor: "var(--board-line)" }}
                  >
                    <span className="min-w-0 truncate text-[13px]">
                      <Link
                        href={`/players/${player.id}`}
                        className="underline decoration-[var(--board-line)] underline-offset-4"
                      >
                        {player.nickname}
                      </Link>
                      {player.clubName === null ? null : (
                        <span className="ml-2 text-[10.5px]" style={{ color: "var(--board-ink-dim)" }}>
                          {player.clubName}
                        </span>
                      )}
                      {label === null ? null : (
                        <span className="ml-2 text-[10.5px]" style={{ color: "var(--board-alert)" }}>
                          {label}
                        </span>
                      )}
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
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </>
  );
}
