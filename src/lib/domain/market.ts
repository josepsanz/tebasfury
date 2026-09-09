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
  /** What this manager paid to get the player, or null when that purchase is outside the log. */
  acquiredFor: number | null;
  /** What the sale fetched. Null only if the API reported no amount, which it never has. */
  releasedFor: number | null;
  /**
   * Sale price minus purchase price, or null when either end is unknown.
   *
   * Null and not zero, and the distinction is the whole point: a player bought before the
   * log began has an unknowable profit, and calling it nought would report a manager who
   * doubled their money as having broken even. The same refusal `hours` already makes
   * about a period it cannot measure.
   */
  profit: number | null;
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

  /**
   * The open acquisition per manager and player, keyed as `${managerId}:${playerId}`.
   * Carries the price as well as the instant, so a sale can be priced against what the
   * player actually cost rather than against nothing.
   */
  const open = new Map<string, { at: Date; amount: number | null }>();
  const result: Holding[] = [];

  for (const operation of ordered) {
    const kind = operationKind(operation.activityType);
    const playerId = operation.playerId as string;
    const key = `${operation.actorManagerId}:${playerId}`;

    if (kind === "bought" || kind === "transfer") {
      open.set(key, { at: operation.occurredAt, amount: operation.amount });
      continue;
    }

    if (kind !== "sold") continue;

    const acquired = open.get(key) ?? null;
    open.delete(key);
    const acquiredAt = acquired?.at ?? null;
    const acquiredFor = acquired?.amount ?? null;
    const releasedFor = operation.amount;
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
      acquiredFor,
      releasedFor,
      profit:
        acquiredFor === null || releasedFor === null ? null : releasedFor - acquiredFor,
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
  /** Bought from the market. Money out. */
  bought: MoneySide;
  /** Sold to the market — a choice, which is what makes it a sale. Money in. */
  sold: MoneySide;
  /** Paid to take a player off another manager. Money out. */
  clausesPaid: MoneySide;
  /** Charged when a player was taken off them. Money IN, and not a sale. */
  clausesCharged: MoneySide;

  cashIn: number;
  cashOut: number;
  /** Cash in minus cash out. Positive means this manager took more than they spent. */
  difference: number;
};

/**
 * What one manager's trading has cost and earned, as far back as the log reaches.
 *
 * **Four sides, not two, because a clause payment is not a sale.** Being charged for a
 * player somebody took off you is money in, but it is not selling: you did not choose.
 * Folding it into "sold" would inflate a raided manager's sales with deals they never
 * made, and would put this file at odds with `holdings` in the same breath — that
 * function already refuses to call a clause loss a sale, because the five-day rule is
 * about choosing to sell. Now money and fair play agree on the word.
 *
 * The types were measured before any of this was designed: 31, 33 and 1 carry an amount
 * in every row, 1 is the only manager-to-manager kind and always names a counterparty,
 * and it holds the single largest sum in the log (124M as of 2026-09-09). Its direction
 * follows the one the fair-play slice settled by evidence — in a type-1 the ACTOR ends up
 * holding the player — so the actor paid the clause and the counterparty was charged it.
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

  const of = (kind: OperationKind, role: "actor" | "counterparty") =>
    side(
      priced.filter(
        (o) =>
          operationKind(o.activityType) === kind &&
          (role === "actor"
            ? o.actorManagerId === managerId
            : o.counterpartyManagerId === managerId),
      ),
    );

  const bought = of("bought", "actor");
  const sold = of("sold", "actor");
  const clausesPaid = of("transfer", "actor");
  const clausesCharged = of("transfer", "counterparty");

  const cashIn = sold.total + clausesCharged.total;
  const cashOut = bought.total + clausesPaid.total;

  return { bought, sold, clausesPaid, clausesCharged, cashIn, cashOut, difference: cashIn - cashOut };
}
