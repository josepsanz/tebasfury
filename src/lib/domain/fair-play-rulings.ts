/**
 * What the league decided about one fair-play breach. Pure, so the rules are tested
 * without a database.
 *
 * The breach itself is still arithmetic over the operation log and is never stored; only
 * the league's answer to it is. A breach nobody has ruled on is `pending`, which is why a
 * missing row and a `pending` row read the same everywhere.
 */

export const RULING_STATUSES = ["pending", "remedied", "waived"] as const;

export type RulingStatus = (typeof RULING_STATUSES)[number];

export type Ruling = { status: RulingStatus; note: string | null };

/** What every breach says until somebody rules on it. */
export const UNRULED: Ruling = { status: "pending", note: null };

export const RULING_LABEL: Record<RulingStatus, string> = {
  pending: "Still pending",
  remedied: "Remedied",
  // Stored as `waived`, shown as "Excused": the league's word for a breach it accepts.
  waived: "Excused",
};

/** A note is a line beside a row, not an essay. */
export const MAX_NOTE = 200;

export type RulingInput = { saleId: string; status: string; note: string };

export type RulingRejection = "unknown-status" | "too-long";

export type RulingVerdict =
  | { ok: true; value: { saleId: string; status: RulingStatus; note: string | null } }
  | { ok: false; reason: RulingRejection };

/** Whether a sale is a breach at all is the caller's to check; it needs the log. */
export function validateRuling(input: RulingInput): RulingVerdict {
  if (!(RULING_STATUSES as readonly string[]).includes(input.status)) {
    return { ok: false, reason: "unknown-status" };
  }
  const note = input.note.trim();
  if (note.length > MAX_NOTE) return { ok: false, reason: "too-long" };
  return {
    ok: true,
    value: { saleId: input.saleId, status: input.status as RulingStatus, note: note === "" ? null : note },
  };
}
