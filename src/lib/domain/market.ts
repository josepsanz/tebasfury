/**
 * The league's market, and the group's one internal rule over it.
 *
 * Its own module rather than part of `domain/players.ts`: that file is a catalogue of
 * players and this is a sequence of events over time, and the two share no vocabulary
 * beyond a player id.
 */

/** A market operation, as the domain needs it. */
export type MarketOperation = {
  id: string;
  activityType: number;
  actorManagerId: number;
  counterpartyManagerId: number | null;
  playerId: string | null;
  amount: number | null;
  occurredAt: Date;
};

export type OperationKind = "bought" | "sold" | "transfer" | "other";

/**
 * What an opaque `activityTypeId` means.
 *
 * Three of the six observed values have names, and they were settled by evidence
 * rather than by guesswork: for every entry the probe asked whether the player is NOW
 * in the acting manager's squad. Type 31's players are still held 27 times out of 32,
 * type 33's are gone in 23 of 30, and in a type-1 transfer the actor holds the player
 * far more often than the counterparty does.
 *
 * Everything else is `other`, on purpose and without a `throw`. The set is open — a
 * seventh type next week must flow through this function into the feed's "not drawn"
 * branch rather than crash a page. Type 4 is the specific one to resist naming: it
 * carries no amount and its players are usually still held, so calling it a release
 * would not produce a wrong number, it would accuse a person.
 */
export function operationKind(activityType: number): OperationKind {
  if (activityType === 31) return "bought";
  if (activityType === 33) return "sold";
  if (activityType === 1) return "transfer";
  return "other";
}

/**
 * Hours a player must be held before being sold. Five days, as the group states it.
 *
 * Elapsed time rather than calendar days: calendar days need a timezone to cut the day
 * on, and would give a purchase at 23:50 a first "day" of ten minutes. The comparison
 * is strict — exactly this many hours is kept, not broken — and there is no grace
 * margin below it, because a second threshold to soften the first is a second number
 * to explain every time somebody asks, and the rule's whole value is being quotable.
 */
export const HOLD_HOURS = 120;

export type Holding = {
  managerId: number;
  playerId: string;
  /** Null when the acquisition happened before this log began. */
  acquiredAt: Date | null;
  releasedAt: Date;
  /** Null whenever `acquiredAt` is: an unknown period is not a number. */
  hours: number | null;
  /** False when `hours` is null. Unknown is never a breach — and never a clean record. */
  breach: boolean;
};

const HOUR = 60 * 60 * 1000;

/**
 * Every completed holding the operations describe, oldest sale first.
 *
 * A holding ends only at a VOLUNTARY sale — a manager choosing to sell to the market.
 * Losing a player to a clause is one row describing two things, and read from the
 * losing side it is not a sale: they did not choose. Counting it would point the public
 * log at the manager who was raided, which is backwards from what the rule discourages.
 * See Ruling 3.
 *
 * A holding begins at the most recent prior acquisition of that player by that
 * manager, which is either a purchase or a received transfer. Most recent, not first:
 * a manager who buys, sells and re-buys the same player has two independent holdings,
 * and pairing the second sale with the first purchase would invent a period that never
 * happened.
 *
 * A sale with no acquisition in the operations is reported with a null period rather
 * than dropped. In the first week after deployment that is most of the feed — the
 * activity window only reaches back seven days — and the page has to say "we do not
 * know" instead of implying either verdict. See Ruling 5.
 */
export function holdings(operations: MarketOperation[]): Holding[] {
  const ordered = [...operations]
    .filter((operation) => operation.playerId !== null)
    .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());

  /** The open acquisition per manager and player, keyed as `${managerId}:${playerId}`. */
  const open = new Map<string, Date>();
  const result: Holding[] = [];

  for (const operation of ordered) {
    const kind = operationKind(operation.activityType);
    const playerId = operation.playerId as string;
    const key = `${operation.actorManagerId}:${playerId}`;

    if (kind === "bought" || kind === "transfer") {
      open.set(key, operation.occurredAt);
      continue;
    }

    if (kind !== "sold") continue;

    const acquiredAt = open.get(key) ?? null;
    open.delete(key);
    const hours =
      acquiredAt === null
        ? null
        : (operation.occurredAt.getTime() - acquiredAt.getTime()) / HOUR;
    result.push({
      managerId: operation.actorManagerId,
      playerId,
      acquiredAt,
      releasedAt: operation.occurredAt,
      hours,
      breach: hours !== null && hours < HOLD_HOURS,
    });
  }

  return result;
}

export type MoneySide = {
  count: number;
  total: number;
  /** Null when nothing is counted: a mean of no operations is not zero. */
  average: number | null;
  /** The single largest, or null when nothing is counted. */
  biggest: { playerId: string; amount: number } | null;
};

export type MarketSummary = {
  bought: MoneySide;
  sold: MoneySide;
  /** Money in minus money out. Positive means this manager took more than they spent. */
  balance: number;
};

/**
 * What one manager's trading has cost and earned, as far back as the log reaches.
 *
 * **A transfer counts on both sides, and that is the one judgement here.** Types 31 and
 * 33 are dealings with the market and name no counterparty; type 1 is manager to
 * manager, always carries an amount, and holds the single largest sum in the log
 * (124M as of 2026-09-09). Leaving it out would show a manager who spent that on a
 * clause as having spent nothing.
 *
 * Its direction follows the one the fair-play slice already settled by evidence — in a
 * type-1 the ACTOR ends up holding the player — so the actor paid and the counterparty
 * was paid. Inference from a measured direction, not a documented fact, which is why the
 * page says buys and sales include clause moves rather than leaving a reader to assume
 * these are shop transactions only.
 *
 * Note this is deliberately NOT how `holdings` reads the same row: there a transfer is
 * an acquisition for the actor and NOT a sale by the counterparty, because the five-day
 * rule is about choosing to sell and being raided is not a choice. Money and fair play
 * ask different questions of one row, and both answers are right.
 *
 * Every kind is filtered for a non-null amount even though all three carry one in every
 * row measured: the column is nullable, and a summary that silently counted a null as
 * zero would drag an average down with an operation it could not price.
 */
export function marketSummary(operations: MarketOperation[], managerId: number): MarketSummary {
  const priced = operations.filter(
    (o): o is MarketOperation & { amount: number; playerId: string } =>
      o.amount !== null && o.playerId !== null,
  );

  const side = (rows: typeof priced): MoneySide => {
    const total = rows.reduce((sum, o) => sum + o.amount, 0);
    return {
      count: rows.length,
      total,
      average: rows.length === 0 ? null : Math.round(total / rows.length),
      biggest:
        rows.length === 0
          ? null
          : (({ playerId, amount }) => ({ playerId, amount }))(
              rows.reduce((best, o) => (o.amount > best.amount ? o : best), rows[0]),
            ),
    };
  };

  const bought = side(
    priced.filter((o) => {
      const kind = operationKind(o.activityType);
      return (kind === "bought" || kind === "transfer") && o.actorManagerId === managerId;
    }),
  );

  const sold = side(
    priced.filter((o) => {
      const kind = operationKind(o.activityType);
      if (kind === "sold") return o.actorManagerId === managerId;
      return kind === "transfer" && o.counterpartyManagerId === managerId;
    }),
  );

  return { bought, sold, balance: sold.total - bought.total };
}
