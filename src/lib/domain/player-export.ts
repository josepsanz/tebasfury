import { clauseStatus } from "./market";
import { pointsPerMillion, valueSeries, valueTrend, type CatalogueRow, type ValuePoint } from "./players";
import { daysBefore, FORM_ROUNDS } from "./targets";

/**
 * Every player as one CSV, for analysis away from the site.
 *
 * Raw figures only: whole euros rather than "10.0M", ISO timestamps rather than "free in 6
 * hours", and a blank cell for anything unknown. A spreadsheet can format a number; it
 * cannot parse one back out of a label. Blank is never zero, for the reason the catalogue
 * gives: nought is a claim.
 */

export type ListingRecord = { kind: string; expiresAt: Date; bids: number | null };

export type PlayerExportInput = {
  rows: CatalogueRow[];
  /** Each player's most recent value readings, in any order. Fifteen days' worth is plenty. */
  values: Map<string, ValuePoint[]>;
  /** Points per recorded gameweek, NEWEST FIRST — only the first `FORM_ROUNDS` are read. */
  points: Map<string, number[]>;
  listings: Map<string, ListingRecord>;
};

export const PLAYER_EXPORT_COLUMNS = [
  "id",
  "name",
  "position",
  "club",
  "status",
  "owner",
  "value",
  "value_date",
  "change_1d",
  "trend_per_day",
  "change_7d",
  "growth_7d_pct",
  "change_14d",
  "growth_14d_pct",
  "buyout_clause",
  "clause_multiple",
  "clause_state",
  "locked",
  "locked_until",
  "shielded",
  "listing",
  "listing_expires_at",
  "bids",
  "season_points",
  "gameweeks_recorded",
  "average_points",
  "form_3",
  "points_per_million",
] as const;

type Column = (typeof PLAYER_EXPORT_COLUMNS)[number];
type Cell = string | number | boolean | null;

const round = (n: number | null, places: number) =>
  n === null ? null : Math.round(n * 10 ** places) / 10 ** places;

export function toCsvField(cell: Cell): string {
  if (cell === null) return "";
  const text = String(cell);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** The change since the reading exactly `days` before the newest; null if that day was missed. */
function changeOver(newest: ValuePoint | null, byDay: Map<string, number>, days: number) {
  if (newest === null) return { change: null, growth: null };
  const then = byDay.get(daysBefore(newest.takenOn, days));
  if (then === undefined) return { change: null, growth: null };
  return { change: newest.value - then, growth: then > 0 ? (newest.value / then - 1) * 100 : null };
}

function record(row: CatalogueRow, input: PlayerExportInput, now: Date): Record<Column, Cell> {
  const readings = valueSeries(input.values.get(row.id) ?? []);
  const newest = readings.at(-1) ?? null;
  const byDay = new Map(readings.map((r) => [r.takenOn, r.value]));
  const day = changeOver(newest, byDay, 1);
  const week = changeOver(newest, byDay, 7);
  const fortnight = changeOver(newest, byDay, 14);

  const owned = row.ownerTeamId !== null;
  const clause = owned ? clauseStatus({ lockedUntil: row.clauseLockedUntil, shielded: row.shielded }, now) : null;
  const lockLive = row.clauseLockedUntil !== null && row.clauseLockedUntil > now;

  // An expired listing is no listing, whatever the last read said — `cheapestRoute`'s rule.
  const found = input.listings.get(row.id);
  const listing = found && found.expiresAt > now ? found : null;

  const recent = (input.points.get(row.id) ?? []).slice(0, FORM_ROUNDS);
  const form = recent.length === FORM_ROUNDS ? recent.reduce((a, b) => a + b, 0) / FORM_ROUNDS : null;

  return {
    id: row.id,
    name: row.nickname,
    position: row.position,
    club: row.clubName,
    status: row.status,
    owner: row.ownerName,
    value: row.currentValue,
    value_date: newest?.takenOn ?? null,
    change_1d: day.change,
    trend_per_day: valueTrend(readings)?.slope ?? null,
    change_7d: week.change,
    growth_7d_pct: round(week.growth, 2),
    change_14d: fortnight.change,
    growth_14d_pct: round(fortnight.growth, 2),
    buyout_clause: row.buyoutClause,
    clause_multiple:
      row.buyoutClause !== null && row.currentValue ? round(row.buyoutClause / row.currentValue, 4) : null,
    clause_state: clause?.state ?? null,
    locked: owned ? lockLive : null,
    locked_until: lockLive ? row.clauseLockedUntil!.toISOString() : null,
    shielded: owned ? row.shielded : null,
    listing: listing === null ? null : listing.kind === "league" ? "auction" : "listed",
    listing_expires_at: listing?.expiresAt.toISOString() ?? null,
    bids: listing?.bids ?? null,
    season_points: row.seasonPoints,
    gameweeks_recorded: row.gameweeksRecorded,
    average_points: round(row.averagePoints, 2),
    form_3: round(form, 2),
    points_per_million: round(pointsPerMillion(row.seasonPoints, row.currentValue), 4),
  };
}

/**
 * RFC 4180 with CRLF line ends, opened by a UTF-8 byte order mark: without it Excel reads
 * the file as Windows-1252 and every accented name comes out garbled. Pandas and Sheets
 * both skip it.
 */
export function playersCsv(input: PlayerExportInput, now: Date): string {
  const lines = [
    PLAYER_EXPORT_COLUMNS.join(","),
    ...input.rows.map((row) => {
      const cells = record(row, input, now);
      return PLAYER_EXPORT_COLUMNS.map((column) => toCsvField(cells[column])).join(",");
    }),
  ];
  return `﻿${lines.join("\r\n")}\r\n`;
}
