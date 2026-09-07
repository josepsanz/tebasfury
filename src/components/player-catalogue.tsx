"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  filterCatalogue,
  formatMoney,
  sortCatalogue,
  type CatalogueRow,
  type SortKey,
} from "@/lib/domain/players";

const PAGE = 60;

const POSITIONS = ["Goalkeeper", "Defender", "Midfielder", "Forward", "Coach"];

const SORTS: { key: SortKey; label: string }[] = [
  { key: "value", label: "Most valuable" },
  { key: "points", label: "Highest scoring" },
  { key: "average", label: "Best average" },
  { key: "name", label: "By name" },
];

const OWNERSHIP: { key: "all" | "owned" | "free"; label: string }[] = [
  { key: "all", label: "Everyone" },
  { key: "owned", label: "Owned" },
  { key: "free", label: "Free" },
];

/**
 * Task 1 established the five real `status` values. Translating them to proper
 * English is naming a known vocabulary, not inventing one; any value not in this map
 * (there is none today) falls back to the raw string rather than vanishing.
 * `ok` is deliberately absent — availability is only worth surfacing as a problem.
 */
const STATUS_LABELS: Record<string, string> = {
  out_of_league: "Out of the league",
  injured: "Injured",
  doubtful: "Doubtful",
  suspended: "Suspended",
};

/** The pill treatment the progress view already uses for pinning managers. */
function Pill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="rounded-full border px-3 py-1 text-[12px]"
      style={{
        borderColor: active ? "var(--board-ink-dim)" : "var(--board-line)",
        color: active ? "var(--board-ink)" : "var(--board-ink-dim)",
      }}
    >
      {children}
    </button>
  );
}

function Owner({ row, ownershipKnown }: { row: CatalogueRow; ownershipKnown: boolean }) {
  if (row.ownerName !== null) return <>{row.ownerName}</>;
  // Nobody has read the squads yet, so "unowned" is a gap in what we know, not a fact
  // about the player.
  if (!ownershipKnown) {
    return <span style={{ color: "var(--board-ink-dim)" }}>Owners not swept yet</span>;
  }
  return <span style={{ color: "var(--board-free)" }}>Free agent</span>;
}

export function PlayerCatalogue({
  rows,
  ownershipKnown,
}: {
  rows: CatalogueRow[];
  ownershipKnown: boolean;
}) {
  const [query, setQuery] = useState("");
  const [position, setPosition] = useState<string | null>(null);
  const [ownership, setOwnership] = useState<"all" | "owned" | "free">("all");
  const [sort, setSort] = useState<SortKey>("value");
  const [shown, setShown] = useState(PAGE);

  const visible = useMemo(
    () => sortCatalogue(filterCatalogue(rows, { query, position, ownership }), sort),
    [rows, query, position, ownership, sort],
  );

  if (rows.length === 0) {
    return (
      <p className="mt-6" style={{ color: "var(--board-ink-dim)" }}>
        No players have been swept yet. An admin can run the first sweep from the Sync page.
      </p>
    );
  }

  return (
    <div className="mt-6">
      <input
        type="search"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setShown(PAGE);
        }}
        placeholder="Search a player"
        aria-label="Search a player"
        className="w-full rounded-md border px-3 py-2 text-[14px]"
        style={{ background: "transparent", color: "var(--board-ink)" }}
      />

      <div className="mt-3 flex flex-wrap gap-2">
        {POSITIONS.map((name) => (
          <Pill
            key={name}
            active={position === name}
            onClick={() => {
              setPosition(position === name ? null : name);
              setShown(PAGE);
            }}
          >
            {name}
          </Pill>
        ))}
      </div>

      <div className="mt-2 flex flex-wrap gap-2">
        {OWNERSHIP.map((option) => (
          <Pill
            key={option.key}
            active={ownership === option.key}
            onClick={() => {
              setOwnership(option.key);
              setShown(PAGE);
            }}
          >
            {option.label}
          </Pill>
        ))}
        {SORTS.map((option) => (
          <Pill key={option.key} active={sort === option.key} onClick={() => setSort(option.key)}>
            {option.label}
          </Pill>
        ))}
      </div>

      <ol className="mt-5">
        {visible.slice(0, shown).map((row) => (
          <li key={row.id} style={{ borderColor: "var(--board-line)" }} className="border-b">
            <Link
              href={`/players/${row.id}`}
              className="grid grid-cols-[1fr_auto] items-center gap-3 py-[11px]"
            >
              <span className="min-w-0">
                <span className="block truncate text-[14.5px]">{row.nickname}</span>
                <span className="block truncate text-[11px]" style={{ color: "var(--board-ink-dim)" }}>
                  {row.position} · <Owner row={row} ownershipKnown={ownershipKnown} />
                  {row.status === "ok" ? null : (
                    <span style={{ color: "var(--board-alert)" }}>
                      {" "}
                      · {STATUS_LABELS[row.status] ?? row.status}
                    </span>
                  )}
                </span>
              </span>
              <span className="text-right">
                <span
                  className="block text-[20px] font-normal tabular-nums leading-none"
                  style={{ fontFamily: "var(--font-barlow-condensed)" }}
                >
                  {row.currentValue === null ? "—" : formatMoney(row.currentValue)}
                </span>
                <span className="block text-[11px] tabular-nums" style={{ color: "var(--board-ink-dim)" }}>
                  {row.seasonPoints} pts
                  {row.averagePoints === null ? "" : ` · ${row.averagePoints.toFixed(1)} avg`}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ol>

      {visible.length === 0 && (
        <p className="mt-6" style={{ color: "var(--board-ink-dim)" }}>
          No player matches that. Clear a filter to widen it.
        </p>
      )}

      {visible.length > shown && (
        <div className="mt-5 flex items-center gap-4">
          <button type="button" onClick={() => setShown(shown + PAGE)} className="board-button">
            Show {PAGE} more
          </button>
          <span className="text-[11px]" style={{ color: "var(--board-ink-dim)" }}>
            Showing {shown} of {visible.length}
          </span>
        </div>
      )}
    </div>
  );
}
