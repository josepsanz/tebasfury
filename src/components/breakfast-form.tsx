"use client";

import { useState, useTransition } from "react";
import { MAX_WHAT } from "@/lib/domain/breakfast-log";

type BreakfastResult = { ok: boolean; message: string };
type BreakfastAction = (formData: FormData) => Promise<BreakfastResult>;

/**
 * Writing one breakfast down, or correcting one.
 *
 * A client component for the reason `NecroporraBallot` is one: a server action wired
 * straight to `action={...}` throws its return value away, and the sentence it answers
 * with is the only way a recorder learns a date was refused.
 *
 * The date input carries no `max`: a day still to come is how a breakfast is planned, and
 * whether a day is past or future is the action's to decide, against Madrid's clock at
 * the moment it saves. After a new entry is recorded
 * only "what" is cleared: the next entry is most often the same day, and sometimes the
 * same manager.
 */
export function BreakfastForm({
  teams,
  action,
  today,
  initial,
  submitLabel,
}: {
  teams: { id: string; managerName: string }[];
  action: BreakfastAction;
  today: string;
  initial?: { id: number; teamId: string; broughtOn: string; what: string | null };
  submitLabel: string;
}) {
  const [result, setResult] = useState<BreakfastResult | null>(null);
  const [pending, startTransition] = useTransition();

  const field =
    "min-w-0 rounded-[3px] border bg-transparent px-2 py-[5px] text-[13px] [color-scheme:dark]";
  const fieldStyle = { borderColor: "var(--board-line)", background: "var(--board-panel)" };

  return (
    <form
      className="mt-4"
      onSubmit={(event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const formData = new FormData(form);
        startTransition(async () => {
          const answer = await action(formData);
          setResult(answer);
          if (answer.ok && initial === undefined) {
            const what = form.elements.namedItem("what");
            if (what instanceof HTMLInputElement) what.value = "";
          }
        });
      }}
    >
      {initial ? <input type="hidden" name="id" value={initial.id} /> : null}
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="date"
          name="broughtOn"
          required
          defaultValue={initial?.broughtOn ?? today}
          aria-label="Day it was brought"
          className={field}
          style={fieldStyle}
        />
        <select
          name="teamId"
          required
          defaultValue={initial?.teamId ?? ""}
          aria-label="Who brought it"
          className={field}
          style={fieldStyle}
        >
          <option value="" disabled>
            Who brought it?
          </option>
          {teams.map((team) => (
            <option key={team.id} value={team.id}>
              {team.managerName}
            </option>
          ))}
        </select>
        <input
          type="text"
          name="what"
          maxLength={MAX_WHAT}
          defaultValue={initial?.what ?? ""}
          placeholder="What (optional)"
          aria-label="What they brought"
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
