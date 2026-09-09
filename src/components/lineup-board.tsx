import Link from "next/link";
import {
  nearestFormation,
  type LineupMetric,
  type RankedFormation,
  type Shortfall,
} from "@/lib/domain/lineup";
import { statusLabel, type CatalogueRow } from "@/lib/domain/players";

/**
 * The best eleven a squad can field, and every formation ranked beside it.
 *
 * A server component: no search, no pills, no pagination, so none of these rows cross to
 * the browser — the same reasoning as `SquadList` and `OpportunityBoard`.
 *
 * The diagnosis is this board's most common output, not the podium. Measured on
 * 2026-09-09, four of thirteen managers could field nothing and four more had exactly one
 * option, so the reasons matter more than the ranking for most of the league.
 */

const LINES = ["Goalkeeper", "Defender", "Midfielder", "Forward"] as const;

const plural = (n: number, word: string) => `${n} more ${word}${n === 1 ? "" : "s"}`;

/** A shortfall in words, naming only the lines that are actually short. */
function shortfallWords(shortfall: Shortfall): string {
  const parts = [
    shortfall.goalkeepers > 0 ? plural(shortfall.goalkeepers, "goalkeeper") : null,
    shortfall.defenders > 0 ? plural(shortfall.defenders, "defender") : null,
    shortfall.midfielders > 0 ? plural(shortfall.midfielders, "midfielder") : null,
    shortfall.forwards > 0 ? plural(shortfall.forwards, "forward") : null,
  ].filter((part): part is string => part !== null);
  return parts.join(", ");
}

function Eleven({
  showing,
  metric,
}: {
  showing: RankedFormation;
  metric: LineupMetric;
}) {
  const figure = (player: CatalogueRow) =>
    metric === "points"
      ? `${player.seasonPoints} pts`
      : player.averagePoints === null
        ? "—"
        : `${player.averagePoints.toFixed(1)} avg`;

  return (
    <div className="mt-3 border-t" style={{ borderColor: "var(--board-line)" }}>
      {LINES.map((line) => {
        const players = showing.eleven.filter((p) => p.position === line);
        if (players.length === 0) return null;
        return (
          <div key={line}>
            <div
              className="px-2 py-[4px] text-[10px] uppercase tracking-[0.06em]"
              style={{ background: "var(--board-panel)", color: "var(--board-ink-dim)" }}
            >
              {line} · {players.length}
            </div>
            <ul>
              {players.map((player) => {
                const label = statusLabel(player.status);
                return (
                  <li
                    key={player.id}
                    className="grid grid-cols-[1fr_64px] items-baseline gap-2 border-b px-2 py-[6px]"
                    style={{ borderColor: "var(--board-line)" }}
                  >
                    <span className="min-w-0 truncate text-[13px]">
                      <Link
                        href={`/players/${player.id}`}
                        className="underline decoration-[var(--board-line)] underline-offset-4"
                      >
                        {player.nickname}
                      </Link>
                      {/* Doubt is a judgement, so the player counts and the reader is told. */}
                      {label === null ? null : (
                        <span className="ml-2 text-[10.5px]" style={{ color: "var(--board-alert)" }}>
                          {label}
                        </span>
                      )}
                      {/* Not a floor, a caveat: this average rests on very little. */}
                      {player.gameweeksRecorded < 3 ? (
                        <span className="ml-2 text-[10.5px]" style={{ color: "var(--board-ink-dim)" }}>
                          {player.gameweeksRecorded === 1
                            ? "1 gameweek"
                            : `${player.gameweeksRecorded} gameweeks`}
                        </span>
                      ) : null}
                    </span>
                    <span
                      className="text-right text-[12.5px] tabular-nums"
                      style={{ fontFamily: "var(--font-mono)" }}
                    >
                      {figure(player)}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

export function LineupBoard({
  ranked,
  showing,
  metric,
  teamId,
  ownershipKnown,
}: {
  ranked: RankedFormation[];
  showing: RankedFormation | null;
  metric: LineupMetric;
  teamId: string;
  ownershipKnown: boolean;
}) {
  if (!ownershipKnown) {
    return (
      <p className="mt-3 text-[13px]" style={{ color: "var(--board-ink-dim)" }}>
        No squad has been read yet, so no lineup can be worked out. The next sweep settles
        it.
      </p>
    );
  }

  const nearest = nearestFormation(ranked);
  const best = ranked.find((r) => r.shortfall === null) ?? null;
  const href = (name: string) => `/teams/${teamId}/lineup?by=${metric}&formation=${name}`;

  return (
    <>
      {nearest === null || best !== null ? null : (
        <p className="mt-3 text-[13px]" style={{ color: "var(--board-alert)" }}>
          No formation can be fielded from this squad. The nearest is{" "}
          <strong>{nearest.name}</strong> — {shortfallWords(nearest.shortfall!)} needed.
        </p>
      )}

      {showing === null ? null : (
        <>
          <h2 className="mt-6 text-[15px] font-medium">
            {showing.name}
            <span
              className="ml-3 text-[13px] tabular-nums"
              style={{ fontFamily: "var(--font-mono)", color: "var(--board-ink-dim)" }}
            >
              {metric === "points"
                ? `${showing.total ?? 0} pts`
                : `${(showing.total ?? 0).toFixed(1)} avg`}
            </span>
          </h2>
          <Eleven showing={showing} metric={metric} />
        </>
      )}

      <h3
        className="mt-8 text-[11px] uppercase tracking-[0.06em]"
        style={{ color: "var(--board-ink-dim)" }}
      >
        Every formation
      </h3>
      <ul className="mt-2 border-t" style={{ borderColor: "var(--board-line)" }}>
        {ranked.map((entry) => (
          <li
            key={entry.name}
            className="flex items-baseline justify-between gap-3 border-b px-2 py-[6px] text-[12.5px]"
            style={{
              borderColor: "var(--board-line)",
              background:
                entry.name === showing?.name
                  ? "color-mix(in srgb, var(--board-you) 10%, transparent)"
                  : undefined,
            }}
          >
            <span style={{ fontFamily: "var(--font-mono)" }}>
              {entry.shortfall === null ? (
                <Link href={href(entry.name)} className="underline underline-offset-4">
                  {entry.name}
                </Link>
              ) : (
                <span style={{ color: "var(--board-ink-dim)" }}>{entry.name}</span>
              )}
            </span>
            <span
              className="text-right tabular-nums"
              style={{ fontFamily: "var(--font-mono)", color: "var(--board-ink-dim)" }}
            >
              {entry.shortfall === null
                ? metric === "points"
                  ? `${entry.total ?? 0} pts`
                  : `${(entry.total ?? 0).toFixed(1)} avg`
                : shortfallWords(entry.shortfall)}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}
