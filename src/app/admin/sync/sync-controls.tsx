"use client";

import { useState, useTransition } from "react";
import {
  bootstrapCredential,
  triggerPlayerSweepNow,
  triggerSyncNow,
  type ActionResult,
} from "./actions";
import { buttonLabel, type Busy } from "./button-label";

export function SyncControls({
  hasCredential,
  lastPlayerSweep,
}: {
  hasCredential: boolean;
  lastPlayerSweep: Date | null;
}) {
  const [result, setResult] = useState<ActionResult | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [pending, startTransition] = useTransition();

  const run = (which: Exclude<Busy, null>, action: () => Promise<ActionResult>) => {
    setBusy(which);
    startTransition(async () => setResult(await action()));
  };

  return (
    <div className="mt-6 space-y-6">
      <form
        action={(formData) => run("credential", () => bootstrapCredential(formData))}
        className="space-y-2"
      >
        <label htmlFor="refreshToken" className="block text-sm font-medium">
          Bootstrap refresh token
        </label>
        <textarea
          id="refreshToken"
          name="refreshToken"
          rows={3}
          className="w-full rounded-md border px-3 py-2 font-mono text-xs"
          style={{ background: "transparent", color: "var(--board-ink)" }}
          placeholder="Paste the refresh_token captured at miliga.laliga.com"
        />
        <button type="submit" disabled={pending} className="board-button">
          Store credential
        </button>
      </form>

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          disabled={pending || !hasCredential}
          onClick={() => run("sync", triggerSyncNow)}
          className="board-button board-button-primary"
        >
          {buttonLabel("sync", pending, busy)}
        </button>

        <button
          type="button"
          disabled={pending || !hasCredential}
          onClick={() => run("sweep", triggerPlayerSweepNow)}
          className="board-button"
        >
          {buttonLabel("sweep", pending, busy)}
        </button>
      </div>

      <p className="text-[11px]" style={{ color: "var(--board-ink-dim)" }}>
        {lastPlayerSweep
          ? `Last successful sweep: ${lastPlayerSweep.toISOString()}`
          : "Players have never been swept."}
      </p>

      {result && (
        <p
          role="status"
          className="text-sm"
          style={result.ok ? undefined : { color: "var(--board-alert)" }}
        >
          {result.message}
        </p>
      )}
    </div>
  );
}
