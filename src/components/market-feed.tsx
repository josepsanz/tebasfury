import { holdings, operationKind, type MarketOperation } from "@/lib/domain/market";
import { formatMoney } from "@/lib/domain/players";

/**
 * The league's market, newest first, with sales inside five days marked.
 *
 * Holding periods are computed from the whole operation list rather than per row,
 * because a sale's period depends on a purchase that may be days above it in the feed.
 * The three states a sale can show — kept, broken, unknown — are Ruling 5's whole
 * point: the third is most of the first week and must not read as either of the others.
 *
 * An operation whose kind is `other` is not drawn at all. Ruling 8.
 */
export function MarketFeed({
  operations,
  managerNames,
  playerNames,
}: {
  operations: MarketOperation[];
  managerNames: Map<number, string>;
  playerNames: Map<string, string>;
}) {
  const periodOf = new Map(
    holdings(operations).map((holding) => [
      `${holding.managerId}:${holding.playerId}:${holding.releasedAt.getTime()}`,
      holding,
    ]),
  );

  const manager = (id: number | null) =>
    id === null ? null : (managerNames.get(id) ?? String(id));
  const player = (id: string | null) => (id === null ? null : (playerNames.get(id) ?? id));

  const drawn = operations.filter(
    (operation) => operationKind(operation.activityType) !== "other" && operation.playerId !== null,
  );

  if (drawn.length === 0) {
    return (
      <p className="mt-6" style={{ color: "var(--board-ink-dim)" }}>
        No market movements yet. The next sweep captures the last seven days.
      </p>
    );
  }

  return (
    <ol className="mt-6">
      {drawn.map((operation) => {
        const kind = operationKind(operation.activityType);
        const holding =
          kind === "sold"
            ? periodOf.get(
                `${operation.actorManagerId}:${operation.playerId}:${operation.occurredAt.getTime()}`,
              )
            : undefined;

        return (
          <li
            key={operation.id}
            style={{ borderColor: "var(--board-line)" }}
            className="border-b py-[11px]"
          >
            <span className="grid grid-cols-[1fr_auto] items-baseline gap-3">
              <span className="min-w-0 text-[14.5px]">
                {manager(operation.actorManagerId)}{" "}
                {kind === "bought" ? "bought" : kind === "sold" ? "sold" : "received"}{" "}
                {player(operation.playerId)}
                {kind === "transfer" && operation.counterpartyManagerId !== null
                  ? ` from ${manager(operation.counterpartyManagerId)}`
                  : ""}
              </span>
              <span
                className="tabular-nums text-[14px]"
                style={{ fontFamily: "var(--font-mono)" }}
              >
                {operation.amount === null ? "" : formatMoney(operation.amount)}
              </span>
            </span>
            <span className="mt-0.5 block text-[11px]" style={{ color: "var(--board-ink-dim)" }}>
              {operation.occurredAt.toISOString().slice(0, 16).replace("T", " ")}
              {holding === undefined ? null : (
                <>
                  {" "}
                  · {holding.hours === null
                    ? "held since before this log began"
                    : `held ${(holding.hours / 24).toFixed(1)} days`}
                  {holding.breach && (
                    <span style={{ color: "var(--board-alert)" }}> — inside five days</span>
                  )}
                </>
              )}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
