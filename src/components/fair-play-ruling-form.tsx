"use client";

import { useState, useTransition } from "react";
import {
  MAX_NOTE,
  RULING_LABEL,
  RULING_STATUSES,
  type Ruling,
} from "@/lib/domain/fair-play-rulings";

type RulingResult = { ok: boolean; message: string };
type RulingAction = (formData: FormData) => Promise<RulingResult>;

/**
 * Setting one breach's status and note.
 *
 * A client component for the reason `BreakfastForm` is one: a server action wired straight
 * to `action={...}` throws its return value away, and its sentence is the only way the
 * person ruling learns whether it saved.
 */
export function FairPlayRulingForm({
  saleId,
  ruling,
  action,
  submitLabel,
}: {
  saleId: string;
  ruling: Ruling;
  action: RulingAction;
  submitLabel: string;
}) {
  const [result, setResult] = useState<RulingResult | null>(null);
  const [pending, startTransition] = useTransition();

  const field =
    "min-w-0 rounded-[3px] border bg-transparent px-2 py-[5px] text-[13px] [color-scheme:dark]";
  const fieldStyle = { borderColor: "var(--board-line)", background: "var(--board-panel)" };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        startTransition(async () => setResult(await action(formData)));
      }}
    >
      <input type="hidden" name="saleId" value={saleId} />
      <div className="flex flex-wrap items-center gap-2">
        <select
          name="status"
          defaultValue={ruling.status}
          aria-label="Status"
          className={field}
          style={fieldStyle}
        >
          {RULING_STATUSES.map((status) => (
            <option key={status} value={status}>
              {RULING_LABEL[status]}
            </option>
          ))}
        </select>
        <input
          type="text"
          name="note"
          maxLength={MAX_NOTE}
          defaultValue={ruling.note ?? ""}
          placeholder="Note (optional)"
          aria-label="Note"
          className={`${field} flex-1 basis-[160px]`}
          style={fieldStyle}
        />
        <button
          type="submit"
          disabled={pending}
          className="board-button board-button-primary disabled:opacity-40"
        >
          {pending ? "Saving…" : submitLabel}
        </button>
      </div>
      {result ? (
        <p
          className="mt-2 text-[12px]"
          style={{ color: result.ok ? "var(--board-gain)" : "var(--board-alert)" }}
        >
          {result.message}
        </p>
      ) : null}
    </form>
  );
}
