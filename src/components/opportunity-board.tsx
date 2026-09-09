import Link from "next/link";
import {
  clubOrPosition,
  statusLabel,
  type CatalogueRow,
} from "@/lib/domain/players";
import { OwnerLabel } from "@/components/owner-label";

/**
 * One home-page board: a heading, a line saying what it ranks, up to `BOARD_ROWS` rows,
 * and a link into the catalogue with the same view already applied.
 *
 * A server component on purpose. It has no search, no pills and no pagination, so the
 * rows it is handed never cross to the browser — the deliberate contrast with
 * `/players`, whose whole-catalogue-to-the-client cost is a recorded soft spot.
 *
 * The right-hand figure arrives as a function rather than a field, because the two
 * boards print different quantities there: points per million on one, season points on
 * the other. Keeping the unit outside the component is what stops one column from
 * meaning two things, which is the mistake the merged-ranking layout would have made.
 *
 * Deliberately NOT sharing a row component with the catalogue: that row is a `<Link>`
 * inside a client component with pagination, and sharing would couple a server
 * component to a client one for the sake of a `<span>`.
 */
export function OpportunityBoard({
  title,
  note,
  rows,
  emptyNote,
  figure,
  link,
  ownershipKnown,
  unknownOwnershipNote,
}: {
  title: string;
  note: string;
  rows: CatalogueRow[];
  emptyNote: string;
  figure: (row: CatalogueRow) => { value: string; unit: string };
  /**
   * Omitted when the catalogue itself is empty (before the first sweep): pointing "see
   * all" at a catalogue that says nothing has been swept is worse than no link. A board
   * that is empty while the catalogue has players still gets its link — that link is
   * exactly where a reader goes to see the players who did not qualify.
   */
  link?: { href: string; label: string };
  ownershipKnown: boolean;
  /**
   * When present and `ownershipKnown` is false, this replaces the whole board. Only the
   * free board passes it: "nobody owns them" is a claim the database cannot support
   * until a squad has been read, while "cheapest per point" needs no ownership at all.
   */
  unknownOwnershipNote?: string;
}) {
  const blocked = unknownOwnershipNote !== undefined && !ownershipKnown;

  return (
    <section className="mt-8">
      <h2 className="text-[14px] font-medium">{title}</h2>
      <p className="mt-0.5 text-[11.5px] leading-relaxed" style={{ color: "var(--board-ink-dim)" }}>
        {blocked ? unknownOwnershipNote : note}
      </p>

      {blocked ? null : rows.length === 0 ? (
        <p className="mt-2 text-[11.5px] leading-relaxed" style={{ color: "var(--board-ink-dim)" }}>
          {emptyNote}
        </p>
      ) : (
        <ol className="mt-3">
          {rows.map((row) => {
            const { value, unit } = figure(row);
            return (
              <li key={row.id} style={{ borderColor: "var(--board-line)" }} className="border-b">
                <Link
                  href={`/players/${row.id}`}
                  className="grid grid-cols-[1fr_auto] items-center gap-3 py-[10px]"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[14.5px]">{row.nickname}</span>
                    <span
                      className="block truncate text-[11px]"
                      style={{ color: "var(--board-ink-dim)" }}
                    >
                      {clubOrPosition(row)}
                      {statusLabel(row.status) === null ? null : (
                        <span style={{ color: "var(--board-alert)" }}> · {statusLabel(row.status)}</span>
                      )}
                      {" · "}
                      <OwnerLabel ownerName={row.ownerName} ownershipKnown={ownershipKnown} />
                    </span>
                  </span>
                  <span className="text-right">
                    <span
                      className="block text-[20px] font-normal tabular-nums leading-none"
                      style={{ fontFamily: "var(--font-mono)" }}
                    >
                      {value}
                    </span>
                    <span
                      className="block text-[11px] tabular-nums"
                      style={{ color: "var(--board-ink-dim)" }}
                    >
                      {unit}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ol>
      )}

      {blocked || link === undefined ? null : (
        <Link
          href={link.href}
          className="mt-3 inline-block border-b pb-0.5 text-[11.5px]"
          style={{ borderColor: "var(--board-line)", color: "var(--board-ink-dim)" }}
        >
          {link.label} →
        </Link>
      )}
    </section>
  );
}
