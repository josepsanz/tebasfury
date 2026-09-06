"use client";

import { useState, useTransition } from "react";
import { bootstrapCredential, triggerSyncNow, type ActionResult } from "./actions";

export function SyncControls({ hasCredential }: { hasCredential: boolean }) {
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="mt-6 space-y-6">
      <form
        action={(formData) =>
          startTransition(async () => setResult(await bootstrapCredential(formData)))
        }
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
          placeholder="Paste the refresh_token captured at miliga.laliga.com"
        />
        <button type="submit" disabled={pending} className="rounded-md border px-4 py-2 text-sm">
          Store credential
        </button>
      </form>

      <button
        type="button"
        disabled={pending || !hasCredential}
        onClick={() => startTransition(async () => setResult(await triggerSyncNow()))}
        className="rounded-md bg-black px-4 py-2 text-sm text-white disabled:opacity-40"
      >
        {pending ? "Syncing…" : "Sync now"}
      </button>

      {result && (
        <p role="status" className={result.ok ? "text-sm" : "text-sm text-red-700"}>
          {result.message}
        </p>
      )}
    </div>
  );
}
