"use client";

import { useState, useTransition } from "react";

type ActionResult = { ok: boolean; message: string };
type Action = (formData: FormData) => Promise<ActionResult>;

export type AllowedRow = { email: string; addedAt: Date };

/**
 * Who may sign in, and the two controls that change it.
 *
 * A client component for the reason every other form on this page is one: a server
 * action wired straight to `action={...}` throws its return value away, and the whole
 * point of the reply here is the count — "2 added. 3 already there." is the sentence
 * that stops an owner wondering whether a paste worked.
 *
 * `ActionResult` and `Action` are declared structurally rather than imported from the
 * action module, matching `ClaimList`: the shapes line up and the component stays
 * independent of the server file.
 */
export function AccessList({
  rows,
  adminEmail,
  allow,
  disallow,
}: {
  rows: AllowedRow[];
  adminEmail: string;
  allow: Action;
  disallow: Action;
}) {
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState("");

  const run = (action: Action, formData: FormData, clear = false) =>
    startTransition(async () => {
      const outcome = await action(formData);
      setResult(outcome);
      if (clear && outcome.ok) setDraft("");
    });

  return (
    <div className="mt-3">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const formData = new FormData();
          formData.set("emails", draft);
          run(allow, formData, true);
        }}
      >
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          rows={3}
          placeholder={"joan@gmail.com, marta@gmail.com\nor one per line"}
          className="w-full border px-2 py-1 text-[13px]"
          style={{
            fontFamily: "var(--font-mono)",
            background: "var(--board-panel)",
            borderColor: "var(--board-line)",
            color: "var(--board-ink)",
          }}
        />
        <button
          type="submit"
          disabled={pending || draft.trim() === ""}
          className="board-button board-button-primary mt-2 disabled:opacity-40"
        >
          {pending ? "Saving…" : "Add to the list"}
        </button>
      </form>

      {result ? (
        <p
          className="mt-2 text-[12px]"
          style={{ color: result.ok ? "var(--board-gain)" : "var(--board-alert)" }}
        >
          {result.message}
        </p>
      ) : null}

      <ul className="mt-4 border-t" style={{ borderColor: "var(--board-line)" }}>
        {/* The owner is on the list without being in the table, and cannot be removed
            from here — it is an environment variable, and the row says so rather than
            offering a control that would silently do nothing. */}
        <li
          className="flex items-center justify-between gap-3 border-b py-[6px] text-[13px]"
          style={{ borderColor: "var(--board-line)" }}
        >
          <span style={{ fontFamily: "var(--font-mono)" }}>{adminEmail}</span>
          <span className="text-[10.5px]" style={{ color: "var(--board-ink-dim)" }}>
            admin · always allowed
          </span>
        </li>

        {rows.map((row) => (
          <li
            key={row.email}
            className="flex items-center justify-between gap-3 border-b py-[6px] text-[13px]"
            style={{ borderColor: "var(--board-line)" }}
          >
            <span className="min-w-0 truncate" style={{ fontFamily: "var(--font-mono)" }}>
              {row.email}
            </span>
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                const formData = new FormData();
                formData.set("email", row.email);
                run(disallow, formData);
              }}
              className="shrink-0 text-[11px] underline underline-offset-4 disabled:opacity-40"
              style={{ color: "var(--board-ink-dim)" }}
            >
              remove
            </button>
          </li>
        ))}
      </ul>

      {rows.length === 0 ? (
        <p className="mt-3 text-[12px]" style={{ color: "var(--board-alert)" }}>
          Nobody but the admin can sign in yet. Add the league&rsquo;s addresses above.
        </p>
      ) : null}
    </div>
  );
}
