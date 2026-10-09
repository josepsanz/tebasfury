"use client";

import { useState, useTransition } from "react";

type BreakfastResult = { ok: boolean; message: string };

/**
 * Deleting one breakfast, after asking. A delete cannot be undone, and the row it removes
 * is somebody's shame on the record; one accidental tap on a phone should not erase it.
 */
export function BreakfastDelete({
  id,
  label,
  action,
}: {
  id: number;
  label: string;
  action: (formData: FormData) => Promise<BreakfastResult>;
}) {
  const [result, setResult] = useState<BreakfastResult | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="mt-2 flex items-center gap-3">
      <button
        type="button"
        disabled={pending}
        className="board-button disabled:opacity-40"
        onClick={() => {
          if (!window.confirm(label)) return;
          const formData = new FormData();
          formData.set("id", String(id));
          startTransition(async () => setResult(await action(formData)));
        }}
      >
        Delete
      </button>
      {result ? (
        <span
          className="text-[12px]"
          style={{ color: result.ok ? "var(--board-gain)" : "var(--board-alert)" }}
        >
          {result.message}
        </span>
      ) : null}
    </div>
  );
}
