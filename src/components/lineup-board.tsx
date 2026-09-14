import Link from "next/link";
import {
  LINES,
  nearestFormation,
  type LineupMetric,
  type RankedFormation,
  type Shortfall,
} from "@/lib/domain/lineup";
import { statusLabel, type CatalogueRow } from "@/lib/domain/players";
import { Pitch, type PitchLine, type PitchMark } from "./pitch";

/** Gameweeks recorded below which an average is a caveat, not a fact. */
const THIN_SAMPLE = 3;

/** The `~` mark's own wording — singular for one gameweek, plural otherwise. */
const thinSampleLabel = (gameweeksRecorded: number): string =>
  `Average from ${gameweeksRecorded} gameweek${gameweeksRecorded === 1 ? "" : "s"}`;

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

/**
 * The best eleven, drawn on the same pitch `RoundLineup` draws a round's own eleven on —
 * shared via `./pitch` once this became the second caller its spec had been waiting for.
 *
 * Two marks, decided with the owner and not negotiable: `!` names the status itself
 * (`statusLabel`'s own wording — doubt is a judgement, so the player counts and the
 * reader is told) and `~` names a thin sample (an average is a caveat, not a floor,
 * below `THIN_SAMPLE` gameweeks). The caption beneath explains only the marks that
 * actually appear in THIS eleven, aggregated once — the same shape `RoundLineup`'s own
 * caption uses for its `★`. No mark anywhere, no caption: there is nothing to explain.
 */
function Eleven({
  showing,
  metric,
  portraits,
}: {
  showing: RankedFormation;
  metric: LineupMetric;
  portraits: Map<string, string>;
}) {
  const figure = (player: CatalogueRow) =>
    metric === "points"
      ? `${player.seasonPoints} pts`
      : player.averagePoints === null
        ? "—"
        : `${player.averagePoints.toFixed(1)} avg`;

  const marksFor = (player: CatalogueRow): PitchMark[] => {
    const marks: PitchMark[] = [];
    const label = statusLabel(player.status);
    if (label !== null) marks.push({ symbol: "!", label });
    if (player.gameweeksRecorded < THIN_SAMPLE) {
      marks.push({ symbol: "~", label: thinSampleLabel(player.gameweeksRecorded) });
    }
    return marks;
  };

  // All four lines, always, even the empty ones — see `Pitch`'s own doc comment for why.
  const lines: PitchLine[] = LINES.map((line) => ({
    line,
    players: showing.eleven
      .filter((p) => p.position === line)
      .map((player) => ({
        id: player.id,
        nickname: player.nickname,
        imageUrl: portraits.get(player.id) ?? null,
        figure: figure(player),
        marks: marksFor(player),
      })),
  }));

  const flaggedCount = showing.eleven.filter((p) => statusLabel(p.status) !== null).length;
  const thinCount = showing.eleven.filter((p) => p.gameweeksRecorded < THIN_SAMPLE).length;

  return (
    <div className="mt-3">
      <Pitch lines={lines} />
      {flaggedCount === 0 && thinCount === 0 ? null : (
        <p className="mt-2 text-[10.5px]" style={{ color: "var(--board-ink-dim)" }}>
          {flaggedCount > 0 ? `! injured, doubtful or suspended (${flaggedCount})` : null}
          {flaggedCount > 0 && thinCount > 0 ? " · " : null}
          {thinCount > 0
            ? `~ an average from fewer than ${THIN_SAMPLE} gameweeks (${thinCount})`
            : null}
        </p>
      )}
    </div>
  );
}

export function LineupBoard({
  ranked,
  showing,
  metric,
  teamId,
  ownershipKnown,
  portraits,
}: {
  ranked: RankedFormation[];
  showing: RankedFormation | null;
  metric: LineupMetric;
  teamId: string;
  ownershipKnown: boolean;
  /**
   * Player id to portrait, for the squad this board is drawing. Absent means the API has
   * never pictured them and the pitch draws initials — see `loadPortraits`, which explains
   * why these do not ride along on `CatalogueRow`.
   */
  portraits: Map<string, string>;
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
  const href = (name: string) => `/teams/${teamId}/lineup?by=${metric}&formation=${name}`;

  return (
    <>
      {nearest === null
        ? null
        : nearest.shortfall !== null && (
            <p className="mt-3 text-[13px]" style={{ color: "var(--board-alert)" }}>
              No formation can be fielded from this squad. The nearest is{" "}
              <strong>{nearest.name}</strong> — {shortfallWords(nearest.shortfall)} needed.
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
              {showing.total === null
                ? "—"
                : metric === "points"
                  ? `${showing.total} pts`
                  : `${showing.total.toFixed(1)} avg`}
            </span>
          </h2>
          <Eleven showing={showing} metric={metric} portraits={portraits} />
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
              {entry.shortfall !== null
                ? shortfallWords(entry.shortfall)
                : entry.total === null
                  ? "—"
                  : metric === "points"
                    ? `${entry.total} pts`
                    : `${entry.total.toFixed(1)} avg`}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}
