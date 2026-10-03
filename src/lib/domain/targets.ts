import { clauseStatus, type ClauseStatus } from "./market";
import { formatLeagueMoment, formatSyncedAt } from "./clock";
import { statusLabel } from "./players";

/**
 * Who is worth buying right now. See the 2026-10-03 targets spec, which this follows.
 *
 * Every threshold below was set from the live distribution on 2026-10-03 (seven-day growth
 * among owned players: p25 -8.7%, median -1.8%, p75 +8.5%, p90 +18%; clause / value: p10
 * 1.00, p25 1.10, median 1.37). Change them here and nowhere else.
 */

/**
 * The managers' own rule for buying from one another: an offer must beat value + 10%,
 * because +10% is the most the league's automatic offer can pay. The friends' rule, not
 * LaLiga's, which is why the page says "house rule" beside it.
 */
export const HOUSE_RULE_PREMIUM = 1.1;
export const RISING_FAST = 0.18;
export const FALLING = -0.09;
export const CHEAP_CLAUSE_MULTIPLE = 1.1;
export const IN_FORM_MARGIN = 2;
/** The same three-round cut the per-manager metrics use. */
export const FORM_ROUNDS = 3;
export const STALE_MARKET_MS = 24 * 60 * 60 * 1000;

/** Ratios built from integers land a hair off their decimal; thresholds are inclusive. */
const EPSILON = 1e-9;
const atLeast = (x: number, threshold: number) => x >= threshold - EPSILON;
const atMost = (x: number, threshold: number) => x <= threshold + EPSILON;

export type Route = "auction" | "listed" | "clause";
export type Lens = "investment" | "performance";
export type RouteFilter = Route | "all";

export type TagKey =
  | "rising-fast"
  | "steady-climb"
  | "falling"
  | "cheap-clause"
  | "takeable-soon"
  | "in-form"
  | "no-bids"
  | "injured"
  | "doubtful"
  | "suspended";

export type Tag = { key: TagKey; label: string; tone: "positive" | "warning" | "info" };

export type TargetInput = {
  playerId: string;
  nickname: string;
  position: string;
  status: string;
  /** The newest snapshot. */
  value: number | null;
  /** The snapshot exactly seven / fourteen calendar days before the newest one, if taken. */
  value7DaysAgo: number | null;
  value14DaysAgo: number | null;
  owner: {
    teamId: string;
    managerName: string;
    buyoutClause: number | null;
    clauseLockedUntil: Date | null;
    shielded: boolean;
  } | null;
  listing: { kind: "league" | "team"; expiresAt: Date; bids: number | null } | null;
  /** Points per recorded gameweek, NEWEST FIRST. */
  points: number[];
};

export type Target = {
  playerId: string;
  nickname: string;
  position: string;
  status: string;
  ownerName: string | null;
  value: number | null;
  route: Route | null;
  cost: number | null;
  costMultiple: number | null;
  growth7: number | null;
  growth14: number | null;
  /**
   * The same week as `growth7`, in money per day: what holding the player has been worth
   * per squad place, where the percentage says what it is worth per euro. Shown beside the
   * percentage and never scored, so the ranking does not drift towards the dearest players.
   * Deliberately not `valueTrend`'s three-reading slope, which would disagree with the
   * percentage printed next to it.
   */
  gainPerDay7: number | null;
  form: number | null;
  seasonAverage: number | null;
  investment: number | null;
  performance: number | null;
  /** Null for a player nobody owns. */
  clause: ClauseStatus | null;
  lockedUntil: Date | null;
  tags: Tag[];
};

/** The `YYYY-MM-DD` calendar day `days` before another, as snapshots are keyed. */
export function daysBefore(takenOn: string, days: number): string {
  const [y, m, d] = takenOn.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d - days)).toISOString().slice(0, 10);
}

const growth = (value: number | null, then: number | null) =>
  value === null || then === null || then <= 0 ? null : value / then - 1;

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

const TAG_LABELS: Record<TagKey, string> = {
  "rising-fast": "Rising fast",
  "steady-climb": "Steady climb",
  falling: "Falling",
  "cheap-clause": "Cheap clause",
  "takeable-soon": "Takeable in 24h",
  "in-form": "In form",
  "no-bids": "No bids yet",
  injured: "Injured",
  doubtful: "Doubtful",
  suspended: "Suspended",
};

const tag = (key: TagKey, tone: Tag["tone"]): Tag => ({ key, label: TAG_LABELS[key], tone });

/**
 * Every route open to a buyer now, cheapest first. A listing past its expiry is no route,
 * whatever the last read said: that is what keeps a missed read from offering yesterday's
 * auction. A route that would cost nothing or less is no route either: a zero figure is a
 * missing one, not a bargain.
 *
 * The listed price is value + 10% rounded to whole euros, so it never carries float noise
 * (1_320_000 * 1.1 is 1452000.0000000002). Costs within one euro count as equal, and on a
 * tie the CLAUSE wins, then the auction, then the listing: a clause is unilateral, while a
 * listing still needs the seller to accept.
 */
function cheapestRoute(input: TargetInput, clause: ClauseStatus | null, now: Date): { route: Route; cost: number } | null {
  const open: { route: Route; cost: number }[] = [];
  const live = input.listing !== null && input.listing.expiresAt > now;
  if (live && input.value !== null) {
    if (input.listing?.kind === "league") open.push({ route: "auction", cost: input.value });
    else open.push({ route: "listed", cost: Math.round(input.value * HOUSE_RULE_PREMIUM) });
  }
  if (input.owner?.buyoutClause != null && clause?.state === "takeable") {
    open.push({ route: "clause", cost: input.owner.buyoutClause });
  }
  const priority: Record<Route, number> = { clause: 0, auction: 1, listed: 2 };
  return (
    open
      .filter((o) => o.cost > 0)
      .sort((a, b) => (Math.abs(a.cost - b.cost) <= 1 ? priority[a.route] - priority[b.route] : a.cost - b.cost))[0] ?? null
  );
}

export function toTarget(input: TargetInput, now: Date): Target {
  const clause = input.owner
    ? clauseStatus({ lockedUntil: input.owner.clauseLockedUntil, shielded: input.owner.shielded }, now)
    : null;
  const open = cheapestRoute(input, clause, now);
  const cost = open?.cost ?? null;
  const growth7 = growth(input.value, input.value7DaysAgo);
  const growth14 = growth(input.value, input.value14DaysAgo);
  const gainPerDay7 =
    input.value === null || input.value7DaysAgo === null ? null : (input.value - input.value7DaysAgo) / 7;
  const form = input.points.length >= FORM_ROUNDS ? mean(input.points.slice(0, FORM_ROUNDS)) : null;
  const seasonAverage = input.points.length > 0 ? mean(input.points) : null;

  const investment =
    cost !== null && cost > 0 && input.value !== null && growth7 !== null
      ? (input.value * (1 + growth7)) / cost - 1
      : null;
  const performance = cost !== null && cost > 0 && form !== null ? form / (cost / 1_000_000) : null;

  const tags: Tag[] = [];
  if (growth7 !== null && atLeast(growth7, RISING_FAST)) tags.push(tag("rising-fast", "positive"));
  if (growth7 !== null && growth14 !== null && growth7 > 0 && growth14 > 0) tags.push(tag("steady-climb", "positive"));
  if (growth7 !== null && atMost(growth7, FALLING)) tags.push(tag("falling", "warning"));
  if (open?.route === "clause" && input.value !== null && atMost(open.cost, CHEAP_CLAUSE_MULTIPLE * input.value)) {
    tags.push(tag("cheap-clause", "positive"));
  }
  if (clause?.state === "soon" && !clause.shielded) tags.push(tag("takeable-soon", "info"));
  if (form !== null && seasonAverage !== null && atLeast(form, seasonAverage + IN_FORM_MARGIN)) {
    tags.push(tag("in-form", "positive"));
  }
  if (open?.route === "auction" && input.listing?.bids === 0) tags.push(tag("no-bids", "info"));
  if (input.status === "injured" || input.status === "doubtful" || input.status === "suspended") {
    tags.push({ key: input.status, label: statusLabel(input.status) ?? input.status, tone: "warning" });
  }

  return {
    playerId: input.playerId,
    nickname: input.nickname,
    position: input.position,
    status: input.status,
    ownerName: input.owner?.managerName ?? null,
    value: input.value,
    route: open?.route ?? null,
    cost,
    costMultiple: cost !== null && input.value ? cost / input.value : null,
    growth7,
    growth14,
    gainPerDay7,
    form,
    seasonAverage,
    investment,
    performance,
    clause,
    lockedUntil: input.owner?.clauseLockedUntil ?? null,
    tags,
  };
}

/**
 * Splits the market into what can be ranked and what is locked away.
 *
 * The reader's own players never appear: you cannot buy what you own. A free agent with no
 * open route (an auction that has closed) is not a target at all. An owned player with no
 * open route is counted in the locked group, soonest unlock first; a shield with no dated
 * lock sorts first, since a shield lasts at most a day.
 */
export function buildTargets(
  inputs: TargetInput[],
  { now, readerTeamId }: { now: Date; readerTeamId: string | null },
): { ranked: Target[]; locked: Target[] } {
  const ranked: Target[] = [];
  const locked: Target[] = [];
  for (const input of inputs) {
    if (readerTeamId !== null && input.owner?.teamId === readerTeamId) continue;
    const target = toTarget(input, now);
    if (target.route !== null) ranked.push(target);
    else if (input.owner !== null) locked.push(target);
  }
  const unlockAt = (t: Target) =>
    t.lockedUntil !== null && t.lockedUntil > now ? t.lockedUntil.getTime() : now.getTime();
  locked.sort((a, b) => unlockAt(a) - unlockAt(b) || a.nickname.localeCompare(b.nickname));
  return { ranked, locked };
}

export type TargetView = { lens: Lens; route: RouteFilter; position: string | null; showInjured: boolean };

const LENSES: Lens[] = ["investment", "performance"];
const ROUTES: RouteFilter[] = ["all", "auction", "listed", "clause"];

/** The view the address asks for; anything unrecognised falls back to the default. */
export function parseTargetView(params: Record<string, string | string[] | undefined>): TargetView {
  const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : null);
  return {
    lens: LENSES.find((l) => l === one(params.lens)) ?? "investment",
    route: ROUTES.find((r) => r === one(params.route)) ?? "all",
    position: one(params.position) || null,
    showInjured: one(params.injured) === "shown",
  };
}

/**
 * Filters and orders by the active lens. A row with no score for that lens sinks below every
 * scored one rather than sorting as zero, the same refusal `sortCatalogue` makes. Injured and
 * suspended players are hidden unless asked for; doubtful ones stay, tagged.
 */
export function rankTargets(targets: Target[], view: TargetView): Target[] {
  const score = (t: Target) => (view.lens === "investment" ? t.investment : t.performance);
  return targets
    .filter((t) => view.route === "all" || t.route === view.route)
    .filter((t) => view.position === null || t.position === view.position)
    .filter((t) => view.showInjured || (t.status !== "injured" && t.status !== "suspended"))
    .sort((a, b) => {
      const left = score(a);
      const right = score(b);
      if (left === null && right === null) return a.nickname.localeCompare(b.nickname);
      if (left === null) return 1;
      if (right === null) return -1;
      return right - left || a.nickname.localeCompare(b.nickname);
    });
}

/** Never read, or read more than a day ago. */
export function isMarketStale(readAt: Date | null, now: Date): boolean {
  return readAt === null || now.getTime() - readAt.getTime() > STALE_MARKET_MS;
}

/**
 * The sentence under the Targets header about how far to trust the market it ranks, and
 * whether to say it in the alert colour.
 *
 * Four cases, because the market goes out of date in two different ways. A read over a day
 * old is stale outright. A read from this morning is fresh, but the auction it holds closes
 * at 19:00 and the sweep that reads the next one runs at 19:45, so for most of an hour every
 * day the page ranks a market that has already been settled. Saying nothing in that gap
 * would present yesterday's auction as today's; saying the read is stale would be wrong too,
 * since every listing and clause on it is still current. So the line names the close, and
 * when the new auction will appear, without the alert colour.
 *
 * Expired listings are left out by `buildTargets` whichever their kind — a manager's
 * listing expires as surely as the league's auction — so the stale case says "listings".
 */
export function marketLine(
  readAt: Date | null,
  auctionClosesAt: Date | null,
  now: Date,
): { text: string; stale: boolean } {
  if (readAt === null) {
    return { text: "The market has not been read yet, so only clause routes are ranked.", stale: true };
  }
  if (isMarketStale(readAt, now)) {
    return {
      text: `Market read ${formatLeagueMoment(readAt)}, over a day old. Expired listings are left out.`,
      stale: true,
    };
  }
  const read = `Market read ${formatSyncedAt(readAt, now)}`;
  if (auctionClosesAt === null) return { text: read, stale: false };
  if (auctionClosesAt > now) {
    return { text: `${read} · auction closes ${formatLeagueMoment(auctionClosesAt)}`, stale: false };
  }
  return {
    text: `${read} · today's auction closed ${formatLeagueMoment(auctionClosesAt)}, the new one is read at the next sweep`,
    stale: false,
  };
}
