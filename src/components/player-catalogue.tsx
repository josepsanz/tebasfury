"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  catalogueQuery,
  clubOrPosition,
  parseCatalogueEntry,
  filterCatalogue,
  formatMoney,
  sortCatalogue,
  statusLabel,
  type CatalogueEntry,
  type CatalogueFilter,
  type CatalogueRow,
  type SortKey,
} from "@/lib/domain/players";
import { OwnerLabel } from "@/components/owner-label";
import { ClauseName, ClauseNote } from "@/components/clause-marks";
import type { ClauseStatus } from "@/lib/domain/market";

const PAGE = 60;

/**
 * Search, filter and sort, then take the current page off the front.
 *
 * Pulled out of the component as a plain function — rather than left as an inline
 * `useMemo` — because the one thing a `renderToStaticMarkup` test cannot drive is the
 * component's own filter state (there is no DOM library here to simulate a click or a
 * keystroke). Calling this directly with a filter that actually narrows the input is
 * how "the count line reflects the FILTERED length, not the raw rows count" gets
 * proven at all: `total` here can never equal `rows.length` by accident, because a
 * narrowing filter is passed in explicitly rather than reached by user interaction.
 */
export function paginateCatalogue(
  rows: CatalogueRow[],
  filter: CatalogueFilter,
  sort: SortKey,
  shown: number,
): { page: CatalogueRow[]; total: number } {
  const visible = sortCatalogue(filterCatalogue(rows, filter), sort);
  return { page: visible.slice(0, shown), total: visible.length };
}

const POSITIONS = ["Goalkeeper", "Defender", "Midfielder", "Forward", "Coach"];

const SORTS: { key: SortKey; label: string }[] = [
  { key: "value", label: "Most valuable" },
  { key: "points", label: "Highest scoring" },
  { key: "average", label: "Best average" },
  { key: "perMillion", label: "Best value for money" },
  { key: "name", label: "By name" },
];

const OWNERSHIP: { key: CatalogueFilter["ownership"]; label: string }[] = [
  { key: "all", label: "Everyone" },
  { key: "owned", label: "Owned" },
  { key: "free", label: "Free" },
  // Not "Free in 24h", which would read as the option above it at a later hour. These are
  // two different facts: `Free` is nobody owns them, this is somebody does and tomorrow
  // they can be taken off them. The board's own word for that is takeable.
  { key: "soon", label: "Takeable in 24h" },
];

/**
 * One labelled control. A select rather than a row of pills, and the reason is the row
 * itself: thirteen pills wrapped onto two lines and pushed the first player under the
 * fold on a phone, and every new filter made it worse. Three selects hold the same
 * choices in one line, name the axis they act on ("Sort", not five loose adjectives),
 * and cost nothing to extend when the club filter finally lands.
 */
function Control({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <label className="flex min-w-0 flex-1 flex-col gap-[3px]">
      <span className="text-[9.5px] uppercase tracking-[0.06em]" style={{ color: "var(--board-ink-dim)" }}>
        {label}
      </span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full border px-2 py-[5px] text-[12px]"
        style={{
          background: "var(--board-panel)",
          borderColor: "var(--board-line)",
          color: "var(--board-ink)",
        }}
      >
        {children}
      </select>
    </label>
  );
}

export function PlayerCatalogue({
  rows,
  ownershipKnown,
  clauses,
  now,
}: {
  rows: CatalogueRow[];
  ownershipKnown: boolean;
  /**
   * The server's clock, the same one that built `clauses`. Shared so the "Takeable in 24h"
   * filter and the "free in N hours" label on the rows it keeps can never disagree — and
   * so the list does not shift under a reader whose own clock is wrong.
   */
  now: Date;
  /**
   * Player id to their clause state, worked out on the server.
   *
   * A plain record of already-formatted states rather than dates: this component renders
   * eight hundred rows in the browser, and the date arithmetic — and the timezone the
   * label needs — belong on one server render instead of in every one of them. A player
   * absent from it is unowned, and an unowned player has no lock to report.
   */
  clauses?: Record<string, ClauseStatus>;
}) {
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState(PAGE);

  /**
   * The three filters live in the ADDRESS, not in this component's state.
   *
   * The first attempt kept them in `useState` and seeded them from the URL once, at mount.
   * It looked right and was not: a reader who filtered, opened a player and came back
   * found the catalogue reset, because the address was correct and nobody read it a second
   * time. State that is copied from a source of truth stops being that source at the first
   * navigation.
   *
   * `useSearchParams` re-reads it on every render, so whatever the router does on a back
   * navigation — remount the component or reuse it — the list follows the address.
   */
  const params = useSearchParams();
  const entry = parseCatalogueEntry(Object.fromEntries(params.entries()));
  const { ownership, sort } = entry;
  // Clamped HERE, because this is the one place the list of positions is known. A stale or
  // hand-typed link naming a position that no longer exists gives the reader the whole
  // catalogue rather than an empty one filtered by something they cannot see.
  const position = POSITIONS.includes(entry.position ?? "") ? entry.position : null;

  /**
   * Writes a filter into the address, which is the only way any of them change.
   *
   * `history.replaceState` and not the router: nothing on the server depends on these
   * three, so a navigation would re-render the page to produce the list the browser is
   * already showing. Next keeps `useSearchParams` in step with it, so this is a write to
   * the same thing the render above reads.
   *
   * The search box is deliberately not in here: it would rewrite the address on every
   * keystroke, and a search is a one-off in a way a filter is not.
   */
  const show = (next: Partial<CatalogueEntry>) => {
    const query = catalogueQuery({ sort, ownership, position, ...next });
    window.history.replaceState(null, "", query === "" ? window.location.pathname : `?${query}`);
  };

  const { page, total } = useMemo(
    () =>
      paginateCatalogue(
        rows,
        ownership === "soon"
          ? { query, position, ownership, now }
          : { query, position, ownership },
        sort,
        shown,
      ),
    [rows, query, position, ownership, sort, shown, now],
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
        className="w-full border px-2 py-[6px] text-[13px]"
        style={{
          background: "var(--board-panel)",
          borderColor: "var(--board-line)",
          color: "var(--board-ink)",
        }}
      />

      <div className="mt-2 flex items-end gap-2">
        <Control
          label="Position"
          value={position ?? "all"}
          onChange={(next) => {
            setShown(PAGE);
            show({ position: next === "all" ? null : next });
          }}
        >
          <option value="all">All positions</option>
          {POSITIONS.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </Control>

        <Control
          label="Owner"
          value={ownership}
          onChange={(next) => {
            setShown(PAGE);
            show({ ownership: next as CatalogueFilter["ownership"] });
          }}
        >
          {OWNERSHIP.map((option) => (
            <option key={option.key} value={option.key}>
              {option.label}
            </option>
          ))}
        </Control>

        <Control
          label="Sort"
          value={sort}
          onChange={(next) => show({ sort: next as SortKey })}
        >
          {SORTS.map((option) => (
            <option key={option.key} value={option.key}>
              {option.label}
            </option>
          ))}
        </Control>
      </div>

      <div
        className="mt-3 grid grid-cols-[1fr_84px] gap-3 border-y px-2 py-[5px] text-[10px] uppercase tracking-[0.06em]"
        style={{
          borderColor: "var(--board-line)",
          background: "var(--board-panel)",
          color: "var(--board-ink-dim)",
        }}
      >
        <span>Player</span>
        <span className="text-right">Value / pts</span>
      </div>

      <ol>
        {page.map((row) => {
          const clause = clauses?.[row.id];
          return (
          <li key={row.id} style={{ borderColor: "var(--board-line)" }} className="border-b">
            <Link
              href={`/players/${row.id}`}
              className="grid grid-cols-[1fr_84px] items-center gap-3 px-2 py-[6px]"
            >
              <span className="min-w-0">
                <ClauseName clause={clause}>{row.nickname}</ClauseName>
                <span className="block truncate text-[10.5px]" style={{ color: "var(--board-ink-dim)" }}>
                  {clubOrPosition(row)} · <OwnerLabel ownerName={row.ownerName} ownershipKnown={ownershipKnown} />
                  <ClauseNote clause={clause} />
                  {statusLabel(row.status) === null ? null : (
                    <span style={{ color: "var(--board-alert)" }}>
                      {" "}
                      · {statusLabel(row.status)}
                    </span>
                  )}
                </span>
              </span>
              <span className="text-right">
                <span
                  className="block text-[13px] tabular-nums leading-none"
                  style={{ fontFamily: "var(--font-mono)" }}
                >
                  {row.currentValue === null ? "—" : formatMoney(row.currentValue)}
                </span>
                {/* The clause beside the market value, because they answer different
                    questions: what the player is worth, and what it would cost to take
                    them. They are not proportional — an owner can raise their own clause,
                    and across one captured squad the ratio ran from 1.00 to 7.15 — so
                    neither can be read off the other. Only owned players have one. */}
                {row.buyoutClause === null ? null : (
                  <span
                    className="block text-[10px] tabular-nums"
                    style={{ fontFamily: "var(--font-mono)", color: "var(--board-ink-dim)" }}
                    title="Buyout clause"
                  >
                    clause {formatMoney(row.buyoutClause)}
                  </span>
                )}
                <span
                  className="block text-[10px] tabular-nums"
                  style={{ fontFamily: "var(--font-mono)", color: "var(--board-ink-dim)" }}
                >
                  {row.seasonPoints}
                  {row.averagePoints === null ? "" : ` · ${row.averagePoints.toFixed(1)}`}
                </span>
              </span>
            </Link>
          </li>
          );
        })}
      </ol>

      {total === 0 && (
        <p className="mt-6" style={{ color: "var(--board-ink-dim)" }}>
          No player matches that. Clear a filter to widen it.
        </p>
      )}

      {total > shown && (
        <div className="mt-5 flex items-center gap-4">
          <button type="button" onClick={() => setShown(shown + PAGE)} className="board-button">
            Show {PAGE} more
          </button>
          <span className="text-[11px]" style={{ color: "var(--board-ink-dim)" }}>
            Showing {shown} of {total}
          </span>
        </div>
      )}
    </div>
  );
}
