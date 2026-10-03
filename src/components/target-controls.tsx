"use client";

import type { ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { urlWithParam } from "./picker-url";
import type { TargetView } from "@/lib/domain/targets";

/**
 * The four choices, written into the address so a view is linkable and the back button
 * works. Each select owns one parameter and leaves the others alone (`urlWithParam`). A
 * default is written as no parameter at all, so an untouched page stays `/targets`.
 */
export function TargetControls({ view, positions }: { view: TargetView; positions: string[] }) {
  const router = useRouter();
  const current = useSearchParams();
  const go = (param: string, value: string | null) =>
    router.push(urlWithParam("/targets", current, param, value), { scroll: false });

  return (
    <div className="mt-3 flex gap-2">
      <Select label="Lens" value={view.lens} onChange={(v) => go("lens", v === "investment" ? null : v)}>
        <option value="investment">Investment</option>
        <option value="performance">Performance</option>
      </Select>
      <Select label="Route" value={view.route} onChange={(v) => go("route", v === "all" ? null : v)}>
        <option value="all">All</option>
        <option value="auction">Auction</option>
        <option value="listed">Listed</option>
        <option value="clause">Clause</option>
      </Select>
      <Select label="Position" value={view.position ?? ""} onChange={(v) => go("position", v === "" ? null : v)}>
        <option value="">All</option>
        {positions.map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
      </Select>
      <Select label="Injured" value={view.showInjured ? "shown" : ""} onChange={(v) => go("injured", v === "" ? null : v)}>
        <option value="">Hidden</option>
        <option value="shown">Shown</option>
      </Select>
    </div>
  );
}

function Select({ label, value, onChange, children }: { label: string; value: string; onChange: (v: string) => void; children: ReactNode }) {
  return (
    <label className="flex min-w-0 flex-1 flex-col gap-[3px]">
      <span className="text-[9.5px] uppercase tracking-[0.06em]" style={{ color: "var(--board-ink-dim)" }}>
        {label}
      </span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full border px-2 py-[5px] text-[12px]"
        style={{ background: "var(--board-panel)", borderColor: "var(--board-line)", color: "var(--board-ink)" }}
      >
        {children}
      </select>
    </label>
  );
}
