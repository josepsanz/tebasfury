"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  clubOrPosition,
  filterCatalogue,
  formatMoney,
  sortCatalogue,
  statusLabel,
  type CatalogueFilter,
  type CatalogueRow,
  type SortKey,
} from "@/lib/domain/players";
import { OwnerLabel } from "@/components/owner-label";
import { LockIcon } from "@/components/lock-icon";
import type { ClauseStatus } from "@/lib/domain/market";

/**
 * How a clause state is drawn.
 *
 * One hue at two intensities for `takeable` and `soon`, because they are the same fact at
 * two distances rather than two categories. Deliberately NOT the portal's amber, which
 * means "your team" and nothing else — a colour that means two things means neither.
 *
 * The padlock on `locked` is the second channel: colour alone would fail a reader who
 * cannot separate the greens from the grey.
 */
const CLAUSE_COLOUR: Record<ClauseStatus["state"], string> = {
  takeable: "var(--board-gain)",
  soon: "color-mix(in srgb, var(--board-gain) 55%, var(--board-ink-dim))",
  locked: "var(--board-ink-dim)",
};

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

const OWNERSHIP: { key: "all" | "owned" | "free"; label: string }[] = [
  { key: "all", label: "Everyone" },
  { key: "owned", label: "Owned" },
  { key: "free", label: "Free" },
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
  initialSort = "value",
  initialOwnership = "all",
}: {
  rows: CatalogueRow[];
  ownershipKnown: boolean;
  /**
   * Player id to their clause state, worked out on the server.
   *
   * A plain record of already-formatted states rather than dates: this component renders
   * eight hundred rows in the browser, and the date arithmetic — and the timezone the
   * label needs — belong on one server render instead of in every one of them. A player
   * absent from it is unowned, and an unowned player has no lock to report.
   */
  clauses?: Record<string, ClauseStatus>;
  initialSort?: SortKey;
  initialOwnership?: CatalogueFilter["ownership"];
}) {
  const [query, setQuery] = useState("");
  const [position, setPosition] = useState<string | null>(null);
  const [ownership, setOwnership] = useState<CatalogueFilter["ownership"]>(initialOwnership);
  const [sort, setSort] = useState<SortKey>(initialSort);
  const [shown, setShown] = useState(PAGE);

  const { page, total } = useMemo(
    () => paginateCatalogue(rows, { query, position, ownership }, sort, shown),
    [rows, query, position, ownership, sort, shown],
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
            setPosition(next === "all" ? null : next);
            setShown(PAGE);
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
            setOwnership(next as CatalogueFilter["ownership"]);
            setShown(PAGE);
          }}
        >
          {OWNERSHIP.map((option) => (
            <option key={option.key} value={option.key}>
              {option.label}
            </option>
          ))}
        </Control>

        <Control label="Sort" value={sort} onChange={(next) => setSort(next as SortKey)}>
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
                <span
                  className="block truncate text-[13px]"
                  style={{ color: clause ? CLAUSE_COLOUR[clause.state] : undefined }}
                  title={clause?.label}
                >
                  {clause?.state === "locked" ? (
                    <>
                      <LockIcon />{" "}
                    </>
                  ) : null}
                  {row.nickname}
                </span>
                <span className="block truncate text-[10.5px]" style={{ color: "var(--board-ink-dim)" }}>
                  {clubOrPosition(row)} · <OwnerLabel ownerName={row.ownerName} ownershipKnown={ownershipKnown} />
                  {/* Said in words as well as in colour: the hue answers "can I take
                      this" at a glance, the words answer "when" without a hover. Only a
                      lock gets words — writing "takeable" beside most of a catalogue
                      would be noise. */}
                  {clause === undefined || clause.state === "takeable" ? null : (
                    <span style={{ color: CLAUSE_COLOUR[clause.state] }}> · {clause.label}</span>
                  )}
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
