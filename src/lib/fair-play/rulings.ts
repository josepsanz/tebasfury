import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type * as schema from "@/lib/db/schema";
import { fairPlayRulings } from "@/lib/db/schema";
import { loadMarket } from "@/lib/db/queries";
import { breaches } from "@/lib/domain/market";
import {
  MAX_NOTE,
  RULING_LABEL,
  validateRuling,
  type Ruling,
  type RulingInput,
  type RulingRejection,
  type RulingStatus,
} from "@/lib/domain/fair-play-rulings";

/** Neon HTTP in production, PGlite in tests. Generic over the driver, like the ballot queries. */
type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export type RulingResult = { ok: boolean; message: string };

/** The wording of every refusal, in one place, as the breakfast actions keep theirs. */
const refusal = (reason: RulingRejection | "not-a-breach"): string =>
  ({
    "unknown-status": "That is not a status the league uses.",
    "too-long": `Keep the note under ${MAX_NOTE} characters.`,
    "not-a-breach": "That sale is not a breach of the five-day rule.",
  })[reason];

/** Every ruling the league has made, by the id of the sale it rules on. */
export async function loadRulings(db: Db): Promise<Map<string, Ruling>> {
  const rows = await db
    .select({ saleId: fairPlayRulings.saleId, status: fairPlayRulings.status, note: fairPlayRulings.note })
    .from(fairPlayRulings);
  return new Map(
    rows.map((row) => [row.saleId, { status: row.status as RulingStatus, note: row.note }]),
  );
}

/**
 * Sets the status and note of one breach, replacing whatever was there.
 *
 * The sale must be a breach as the log reads NOW, checked here rather than trusted from the
 * form: a ruling on a clean sale would sit in the table describing nothing on the page. The
 * caller has already checked the permission.
 */
export async function saveRuling(
  db: Db,
  { input, now, recordedBy }: { input: RulingInput; now: Date; recordedBy: string },
): Promise<RulingResult> {
  const verdict = validateRuling(input);
  if (!verdict.ok) return { ok: false, message: refusal(verdict.reason) };

  const { operations, managerNames, playerNames } = await loadMarket(db);
  const breach = breaches(operations).find((holding) => holding.releasedBy === input.saleId);
  if (breach === undefined) return { ok: false, message: refusal("not-a-breach") };

  const row = { status: verdict.value.status, note: verdict.value.note, recordedBy, recordedAt: now };
  await db
    .insert(fairPlayRulings)
    .values({ saleId: input.saleId, ...row })
    .onConflictDoUpdate({ target: fairPlayRulings.saleId, set: row });

  const manager = managerNames.get(breach.managerId) ?? String(breach.managerId);
  const player = playerNames.get(breach.playerId) ?? breach.playerId;
  return {
    ok: true,
    message: `${manager}'s sale of ${player}: ${RULING_LABEL[verdict.value.status]}.`,
  };
}
