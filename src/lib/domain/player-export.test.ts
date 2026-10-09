import { describe, expect, it } from "vitest";
import type { CatalogueRow } from "./players";
import { PLAYER_EXPORT_COLUMNS, playersCsv, toCsvField, type PlayerExportInput } from "./player-export";

const now = new Date("2026-10-09T10:00:00Z");

const row = (over: Partial<CatalogueRow> = {}): CatalogueRow => ({
  id: "p1",
  nickname: "Player",
  position: "Midfielder",
  status: "ok",
  currentValue: 10_000_000,
  seasonPoints: 30,
  averagePoints: 6,
  gameweeksRecorded: 5,
  ownerTeamId: null,
  ownerName: null,
  clubName: "Club",
  buyoutClause: null,
  clauseLockedUntil: null,
  shielded: false,
  ...over,
});

const input = (over: Partial<PlayerExportInput> = {}): PlayerExportInput => ({
  rows: [row()],
  values: new Map(),
  points: new Map(),
  listings: new Map(),
  ...over,
});

/** The CSV as one record per data row, keyed by header, BOM stripped. */
function parse(csv: string): Record<string, string>[] {
  const [header, ...lines] = csv.replace(/^﻿/, "").trimEnd().split("\r\n");
  const keys = header.split(",");
  return lines.map((line) => Object.fromEntries(line.split(",").map((cell, i) => [keys[i], cell])));
}

describe("toCsvField", () => {
  it("quotes only what needs quoting", () => {
    expect(toCsvField("plain")).toBe("plain");
    expect(toCsvField('say "hi", twice')).toBe('"say ""hi"", twice"');
    expect(toCsvField("two\nlines")).toBe('"two\nlines"');
  });

  it("writes nothing for an unknown, never a zero", () => {
    expect(toCsvField(null)).toBe("");
    expect(toCsvField(0)).toBe("0");
    expect(toCsvField(false)).toBe("false");
  });
});

describe("playersCsv", () => {
  it("opens with a BOM and the header, one line per player", () => {
    const csv = playersCsv(input({ rows: [row(), row({ id: "p2" })] }), now);
    expect(csv.startsWith("﻿")).toBe(true);
    const lines = csv.slice(1).trimEnd().split("\r\n");
    expect(lines[0]).toBe(PLAYER_EXPORT_COLUMNS.join(","));
    expect(lines).toHaveLength(3);
  });

  it("measures value change against the readings exactly 1, 7 and 14 days back", () => {
    const values = new Map([
      [
        "p1",
        [
          { takenOn: "2026-09-25", value: 8_000_000 },
          { takenOn: "2026-10-02", value: 9_000_000 },
          { takenOn: "2026-10-07", value: 9_500_000 },
          { takenOn: "2026-10-08", value: 9_800_000 },
          { takenOn: "2026-10-09", value: 10_000_000 },
        ],
      ],
    ]);
    const [out] = parse(playersCsv(input({ values }), now));
    expect(out.value_date).toBe("2026-10-09");
    expect(out.change_1d).toBe("200000");
    expect(out.change_7d).toBe("1000000");
    expect(out.growth_7d_pct).toBe("11.11");
    expect(out.change_14d).toBe("2000000");
    expect(out.growth_14d_pct).toBe("25");
    // Least squares over the last three readings: 9.5M, 9.8M, 10M over days 0, 1, 2.
    expect(out.trend_per_day).toBe("250000");
  });

  it("leaves a change blank when the day it compares with was never swept", () => {
    const values = new Map([
      [
        "p1",
        [
          { takenOn: "2026-10-01", value: 9_000_000 },
          { takenOn: "2026-10-09", value: 10_000_000 },
        ],
      ],
    ]);
    const [out] = parse(playersCsv(input({ values }), now));
    expect(out.change_1d).toBe("");
    expect(out.change_7d).toBe("");
    expect(out.trend_per_day).toBe("");
  });

  it("states an owned player's clause, lock and shield", () => {
    const rows = [
      row({
        ownerTeamId: "t1",
        ownerName: "Manager",
        buyoutClause: 15_000_000,
        clauseLockedUntil: new Date("2026-10-12T08:00:00Z"),
        shielded: true,
      }),
    ];
    const [out] = parse(playersCsv(input({ rows }), now));
    expect(out.owner).toBe("Manager");
    expect(out.buyout_clause).toBe("15000000");
    expect(out.clause_multiple).toBe("1.5");
    expect(out.clause_state).toBe("locked");
    expect(out.locked).toBe("true");
    expect(out.locked_until).toBe("2026-10-12T08:00:00.000Z");
    expect(out.shielded).toBe("true");
  });

  it("leaves the clause columns blank for a free agent", () => {
    const [out] = parse(playersCsv(input(), now));
    expect(out.owner).toBe("");
    expect(out.clause_state).toBe("");
    expect(out.locked).toBe("");
    expect(out.shielded).toBe("");
  });

  it("lists a live listing and drops an expired one", () => {
    const listings = new Map([
      ["p1", { kind: "league", expiresAt: new Date("2026-10-09T17:00:00Z"), bids: 2 }],
      ["p2", { kind: "team", expiresAt: new Date("2026-10-08T17:00:00Z"), bids: null }],
    ]);
    const [live, expired] = parse(playersCsv(input({ rows: [row(), row({ id: "p2" })], listings }), now));
    expect(live.listing).toBe("auction");
    expect(live.bids).toBe("2");
    expect(expired.listing).toBe("");
    expect(expired.listing_expires_at).toBe("");
  });

  it("averages the last three recorded gameweeks as form", () => {
    const points = new Map([["p1", [9, 3, 6, 20]]]);
    const [out] = parse(playersCsv(input({ points }), now));
    expect(out.form_3).toBe("6");
    expect(out.points_per_million).toBe("3");
  });
});
