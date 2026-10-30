import { holdings, operationKind, type MarketOperation } from "./market";
import { toCsvField } from "./player-export";

/**
 * Every operation the log has captured as one CSV, oldest first, for analysis away from
 * the site.
 *
 * Raw figures only, as the player export: whole euros, ISO timestamps, a blank cell for
 * anything unknown. The raw `activity_type` rides beside the named `kind`, because `other`
 * is a refusal to guess and somebody with a spreadsheet may want to guess anyway.
 *
 * An operation that ends a holding — a sale, or a clause taking a player from the
 * counterparty — also carries that holding: how long it lasted, what it made and whether
 * it broke the five-day rule. Blank where `holdings` says unknown, never zero.
 */

export const MARKET_EXPORT_COLUMNS = [
  "id",
  "occurred_at",
  "kind",
  "activity_type",
  "manager_id",
  "manager",
  "counterparty_id",
  "counterparty",
  "player_id",
  "player",
  "amount",
  "held_hours",
  "profit",
  "breach",
] as const;

type Column = (typeof MARKET_EXPORT_COLUMNS)[number];
type Cell = string | number | boolean | null;

export type MarketExportInput = {
  operations: MarketOperation[];
  managerNames: Map<number, string>;
  playerNames: Map<string, string>;
};

/** RFC 4180, CRLF, UTF-8 byte order mark — the player export's reasons apply unchanged. */
export function marketCsv({ operations, managerNames, playerNames }: MarketExportInput): string {
  const ended = new Map(holdings(operations).map((holding) => [holding.releasedBy, holding]));
  const ordered = [...operations].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());

  const lines = [
    MARKET_EXPORT_COLUMNS.join(","),
    ...ordered.map((operation) => {
      const holding = ended.get(operation.id);
      const hours = holding?.hours ?? null;
      const cells: Record<Column, Cell> = {
        id: operation.id,
        occurred_at: operation.occurredAt.toISOString(),
        kind: operationKind(operation.activityType),
        activity_type: operation.activityType,
        manager_id: operation.actorManagerId,
        manager: managerNames.get(operation.actorManagerId) ?? null,
        counterparty_id: operation.counterpartyManagerId,
        counterparty:
          operation.counterpartyManagerId === null
            ? null
            : (managerNames.get(operation.counterpartyManagerId) ?? null),
        player_id: operation.playerId,
        player: operation.playerId === null ? null : (playerNames.get(operation.playerId) ?? null),
        amount: operation.amount,
        held_hours: hours === null ? null : Math.round(hours * 1000) / 1000,
        profit: holding?.profit ?? null,
        // Only where it can be judged: a holding of unknown length is neither.
        breach: hours === null ? null : holding!.breach,
      };
      return MARKET_EXPORT_COLUMNS.map((column) => toCsvField(cells[column])).join(",");
    }),
  ];
  return `﻿${lines.join("\r\n")}\r\n`;
}
