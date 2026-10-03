import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { LockedTargets, TargetList } from "./target-list";
import { toTarget, type TargetInput } from "@/lib/domain/targets";

const now = new Date("2026-10-03T18:00:00Z");
const later = new Date("2026-10-04T17:00:00Z");
const base: TargetInput = {
  playerId: "p1",
  nickname: "Urko",
  position: "Defender",
  status: "ok",
  value: 3_300_000,
  value7DaysAgo: 2_750_000,
  value14DaysAgo: 2_500_000,
  owner: null,
  listing: { kind: "league", expiresAt: later, bids: 0 },
  points: [],
};

describe("TargetList", () => {
  it("draws the route, the cost with its multiple, the growth and the lens score", () => {
    const html = renderToStaticMarkup(<TargetList rows={[toTarget(base, now)]} lens="investment" />);
    expect(html).toContain("Urko");
    expect(html).toContain("Auction");
    expect(html).toContain("3.3M");
    expect(html).toContain("1.00×");
    expect(html).toContain("+20%");
    expect(html).toContain("Rising fast");
    expect(html).toContain("No bids yet");
    expect(html).toContain('href="/players/p1"');
  });

  it("labels a listing's premium as the house rule", () => {
    const listed = toTarget(
      { ...base, owner: { teamId: "t2", managerName: "Bruno", buyoutClause: 99_000_000, clauseLockedUntil: later, shielded: false }, listing: { kind: "team", expiresAt: later, bids: null } },
      now,
    );
    const html = renderToStaticMarkup(<TargetList rows={[listed]} lens="investment" />);
    expect(html).toContain("1.10× house rule");
    expect(html).toContain("Bruno");
  });

  it("shows a dash, not a zero, for a score that cannot be worked out", () => {
    const html = renderToStaticMarkup(<TargetList rows={[toTarget({ ...base, value7DaysAgo: null }, now)]} lens="investment" />);
    expect(html).toContain("—");
  });

  it("says so when nothing matches", () => {
    expect(renderToStaticMarkup(<TargetList rows={[]} lens="performance" />)).toContain("Nobody matches");
  });
});

describe("LockedTargets", () => {
  it("counts the locked players behind a closed summary, with when each frees up", () => {
    const locked = toTarget(
      { ...base, listing: null, owner: { teamId: "t2", managerName: "Bruno", buyoutClause: 9_000_000, clauseLockedUntil: new Date("2026-10-09T10:00:00Z"), shielded: false } },
      now,
    );
    const html = renderToStaticMarkup(<LockedTargets rows={[locked]} />);
    expect(html).toContain("<details");
    expect(html).not.toContain("<details open");
    expect(html).toContain("Locked — no route open (1)");
    expect(html).toContain("locked until");
  });

  it("marks a shielded player as shielded", () => {
    const shielded = toTarget(
      { ...base, listing: null, owner: { teamId: "t2", managerName: "Bruno", buyoutClause: 9_000_000, clauseLockedUntil: null, shielded: true } },
      now,
    );
    expect(renderToStaticMarkup(<LockedTargets rows={[shielded]} />)).toContain("Shielded");
  });

  it("draws nothing when nobody is locked", () => {
    expect(renderToStaticMarkup(<LockedTargets rows={[]} />)).toBe("");
  });
});
