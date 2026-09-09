import Link from "next/link";
import { holdings, operationKind, type MarketOperation } from "@/lib/domain/market";
import { formatMoney } from "@/lib/domain/players";

/**
 * The day and the hour an operation happened, in the league's own timezone.
 *
 * Explicitly Europe/Madrid rather than the machine's zone, so the server renders the
 * same string the reader would have written down. It used to print the raw UTC
 * timestamp, which put every night-time signing two hours earlier than the group
 * remembers it — harmless to the five-day rule, which is computed from the instants
 * themselves, and confusing to anyone reading the feed.
 */
const madrid = (at: Date, opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Madrid", ...opts }).format(at);

/**
 * Which slice of the market to draw. Null draws the lot.
 *
 * A manager's own history includes operations where they are the COUNTERPARTY, not only
 * the actor: a player taken off them by a clause is part of their story, and arguably
 * the part they would most want to point at.
 */
export type MarketFocus = { playerId: string } | { managerId: number } | null;

/**
 * The league's market, newest first, with sales inside five days marked.
 *
 * Holding periods are computed from the whole operation list rather than per row,
 * because a sale's period depends on a purchase that may be days above it in the feed.
 * The three states a sale can show — kept, broken, unknown — are Ruling 5's whole
 * point: the third is most of the first week and must not read as either of the others.
 *
 * An operation whose kind is `other` is not drawn at all. Ruling 8.
 *
 * **`focus` narrows what is DRAWN, never what is computed.** Callers must hand over the
 * whole operation list and let this filter afterwards. Filtering first would be the one
 * mistake this component exists to prevent: a sale's holding period depends on a
 * purchase that a per-player or per-manager filter may well have excluded, and the row
 * would silently fall back to "held since before this log began" — reporting a rule as
 * unknowable when the answer was in the data all along.
 */
export function MarketFeed({
  operations,
  managerNames,
  playerNames,
  teamIdByManagerId,
  focus = null,
}: {
  operations: MarketOperation[];
  managerNames: Map<number, string>;
  playerNames: Map<string, string>;
  /** Manager id to team id, so a name can link to its page. */
  teamIdByManagerId: Map<number, string>;
  focus?: MarketFocus;
}) {
  const periodOf = new Map(
    holdings(operations).map((holding) => [
      `${holding.managerId}:${holding.playerId}:${holding.releasedAt.getTime()}`,
      holding,
    ]),
  );

  const linkClass = "underline decoration-[var(--board-line)] underline-offset-4";

  /**
   * What a holding made or lost. Nothing at all when the purchase predates the log —
   * calling an unknowable profit nought would report a manager who doubled their money
   * as having broken even.
   */
  const Profit = ({ value }: { value: number | null }) =>
    value === null ? null : (
      <span
        className="tabular-nums"
        style={{
          fontFamily: "var(--font-mono)",
          color:
            value > 0
              ? "var(--board-gain)"
              : value < 0
                ? "var(--board-alert)"
                : "var(--board-ink-dim)",
        }}
      >
        {value > 0 ? "▲ " : value < 0 ? "▼ " : ""}
        {formatMoney(Math.abs(value))}
      </span>
    );

  /**
   * A manager's name, linked to their page unless this feed IS their page.
   *
   * A link to the page you are already on is a dead control that costs a tap to find
   * out — so the focused subject renders as plain text, here and for the player below.
   */
  const manager = (id: number | null) => {
    if (id === null) return null;
    const name = managerNames.get(id) ?? String(id);
    const teamId = teamIdByManagerId.get(id);
    if (teamId === undefined) return name;
    if (focus !== null && "managerId" in focus && focus.managerId === id) return name;
    return (
      <Link href={`/teams/${teamId}`} className={linkClass}>
        {name}
      </Link>
    );
  };

  const player = (id: string | null) => {
    if (id === null) return null;
    const name = playerNames.get(id) ?? id;
    if (focus !== null && "playerId" in focus && focus.playerId === id) return name;
    return (
      <Link href={`/players/${id}`} className={linkClass}>
        {name}
      </Link>
    );
  };

  const inFocus = (operation: MarketOperation) => {
    if (focus === null) return true;
    if ("playerId" in focus) return operation.playerId === focus.playerId;
    return (
      operation.actorManagerId === focus.managerId ||
      operation.counterpartyManagerId === focus.managerId
    );
  };

  const drawn = operations.filter(
    (operation) =>
      operationKind(operation.activityType) !== "other" &&
      operation.playerId !== null &&
      inFocus(operation),
  );

  if (drawn.length === 0) {
    return (
      <p className="mt-6 text-[13px]" style={{ color: "var(--board-ink-dim)" }}>
        {focus === null
          ? "No market movements yet. The next sweep captures the last seven days."
          : "Nothing in the market log, which reaches back only as far as the first sweep."}
      </p>
    );
  }

  return (
    <ol className="mt-3 border-t" style={{ borderColor: "var(--board-line)" }}>
      {drawn.map((operation) => {
        const kind = operationKind(operation.activityType);
        const holding =
          kind === "sold"
            ? periodOf.get(
                `${operation.actorManagerId}:${operation.playerId}:${operation.occurredAt.getTime()}`,
              )
            : undefined;

        // A clause is one row describing two moves, and this is the losing side of it:
        // the counterparty gave the player up and was paid for them. Its holding is
        // involuntary, so it carries money and never a five-day verdict.
        const lost =
          kind === "transfer" && operation.counterpartyManagerId !== null
            ? periodOf.get(
                `${operation.counterpartyManagerId}:${operation.playerId}:${operation.occurredAt.getTime()}`,
              )
            : undefined;

        return (
          <li
            key={operation.id}
            style={{ borderColor: "var(--board-line)" }}
            className="grid grid-cols-[42px_1fr_auto] items-baseline gap-3 border-b px-2 py-[7px]"
          >
            <span
              className="text-[10px] leading-[1.25] tabular-nums"
              style={{ fontFamily: "var(--font-mono)", color: "var(--board-ink-dim)" }}
            >
              {madrid(operation.occurredAt, { day: "2-digit", month: "2-digit" })}
              <br />
              {madrid(operation.occurredAt, { hour: "2-digit", minute: "2-digit" })}
            </span>

            <span className="min-w-0">
              <span className="block text-[13px]">
                {manager(operation.actorManagerId)}{" "}
                {kind === "bought" ? "bought" : kind === "sold" ? "sold" : "received"}{" "}
                {player(operation.playerId)}
                {/* As JSX, not interpolated into a template string: `manager` returns
                    an element now, and a string template would render it as
                    "[object Object]". */}
                {kind === "transfer" && operation.counterpartyManagerId !== null ? (
                  <> from {manager(operation.counterpartyManagerId)}</>
                ) : null}
              </span>
              {holding === undefined ? null : (
                <span className="block text-[10.5px]">
                  <span
                    style={{
                      color: holding.breach ? "var(--board-alert)" : "var(--board-ink-dim)",
                    }}
                  >
                    {holding.hours === null
                      ? "held since before this log began"
                      : `held ${(holding.hours / 24).toFixed(1)} days`}
                    {holding.breach && " — inside five days"}
                  </span>
                  {holding.profit === null ? null : (
                    <>
                      {" · "}
                      <Profit value={holding.profit} />
                    </>
                  )}
                </span>
              )}

              {/* The clause seen from the side that lost the player. Named, because this
                  row is written from the receiver's side and an unlabelled figure here
                  would read as the receiver's. No holding period and no five-day mark:
                  they did not choose to sell. */}
              {lost === undefined || lost.profit === null ? null : (
                <span className="block text-[10.5px]" style={{ color: "var(--board-ink-dim)" }}>
                  {managerNames.get(operation.counterpartyManagerId as number) ??
                    operation.counterpartyManagerId}{" "}
                  <Profit value={lost.profit} />
                </span>
              )}
            </span>

            <span
              className="text-right text-[13px] tabular-nums"
              style={{ fontFamily: "var(--font-mono)" }}
            >
              {operation.amount === null ? "" : formatMoney(operation.amount)}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
