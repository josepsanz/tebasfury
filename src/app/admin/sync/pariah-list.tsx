"use client";

import { useState, useTransition } from "react";
import type { PariahCandidate } from "@/lib/pariah";

type ActionResult = { ok: boolean; message: string };
type Action = (formData: FormData) => Promise<ActionResult>;

/**
 * Every manager, and one control on each: declare a pariah, or pardon one.
 *
 * A client component for the reason `AccessList` is one: the reply is the point, and a
 * server action wired straight to `action={...}` throws it away. Pariahs come first and
 * in the alert colour, because the sentences being served are what the admin opens this
 * to check.
 */
export function PariahList({ rows, toggle }: { rows: PariahCandidate[]; toggle: Action }) {
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  const ordered = [...rows.filter((row) => row.isPariah), ...rows.filter((row) => !row.isPariah)];

  return (
    <div className="mt-3">
      {result ? (
        <p
          className="mb-2 text-[12px]"
          style={{ color: result.ok ? "var(--board-gain)" : "var(--board-alert)" }}
        >
          {result.message}
        </p>
      ) : null}

      {ordered.length === 0 ? (
        <p className="text-[12px]" style={{ color: "var(--board-ink-dim)" }}>
          No manager has signed in yet, so there is nobody to shun.
        </p>
      ) : (
        <ul className="border-t" style={{ borderColor: "var(--board-line)" }}>
          {ordered.map((row) => (
            <li
              key={row.userId}
              className="flex items-center justify-between gap-3 border-b py-[6px] text-[13px]"
              style={{ borderColor: "var(--board-line)" }}
            >
              <span className="min-w-0 truncate">
                <span
                  className={row.isPariah ? "line-through" : undefined}
                  style={row.isPariah ? { textDecorationColor: "var(--board-alert)" } : undefined}
                >
                  {row.name}
                </span>
                {row.teamName ? (
                  <span className="ml-2 text-[11px]" style={{ color: "var(--board-ink-dim)" }}>
                    {row.teamName}
                  </span>
                ) : null}
              </span>
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  const formData = new FormData();
                  formData.set("userId", row.userId);
                  formData.set("name", row.name);
                  formData.set("pariah", String(!row.isPariah));
                  startTransition(async () => setResult(await toggle(formData)));
                }}
                className="shrink-0 text-[11px] underline underline-offset-4 disabled:opacity-40"
                style={{ color: row.isPariah ? "var(--board-ink-dim)" : "var(--board-alert)" }}
              >
                {row.isPariah ? "Pardon" : "Declare pariah"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
