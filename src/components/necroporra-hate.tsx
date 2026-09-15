import type { VoteTally } from "@/lib/domain/necroporra";

/**
 * "A", "A and B", or "A, B and C" — the portal's list, with no Oxford comma before the
 * last "and". The same shape `BreakfastLine` writes; kept local to each sentence rather
 * than shared, because three names is already the rare case and a helper travelling
 * between two files would be the larger thing.
 */
function joinNames(names: string[]): string {
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/** One row of a tally: rank, name, count. The two boards below draw the same row. */
function Row({
  rank,
  row,
  mine,
}: {
  rank: number;
  row: VoteTally;
  mine: boolean;
}) {
  return (
    <li
      className="grid grid-cols-[24px_1fr_auto] items-baseline gap-2 border-b px-2 py-[6px]"
      style={{
        borderColor: "var(--board-line)",
        background: mine ? "color-mix(in srgb, var(--board-you) 10%, transparent)" : undefined,
      }}
    >
      <span
        className="text-[12px] tabular-nums"
        style={{ fontFamily: "var(--font-mono)", color: "var(--board-ink-dim)" }}
      >
        {rank}
      </span>
      <span className="truncate text-[13px]">{row.name}</span>
      <span
        className="text-right text-[13px] tabular-nums"
        style={{ fontFamily: "var(--font-mono)", color: row.votes === 0 ? "var(--board-ink-dim)" : undefined }}
      >
        {row.votes}
      </span>
    </li>
  );
}

/**
 * Who the league names most, over every round so far.
 *
 * Led by a sentence rather than by the table, for the reason the breakfast line is a
 * sentence: this is the thing the group says out loud, and a number at the top of a
 * column does not say it. The table underneath is the receipt.
 *
 * Before anybody has voted every team sits on nought, and crowning one of them would be
 * an accusation the data has not made — so that case gets its own line instead.
 */
export function MostHated({
  rows,
  viewerTeamId,
}: {
  rows: VoteTally[];
  /** The reader's own team, so their row is marked. Null when they have claimed none. */
  viewerTeamId: string | null;
}) {
  const top = rows[0]?.votes ?? 0;
  const leaders = rows.filter((row) => row.votes === top && top > 0);

  return (
    <>
      <p className="mt-3 text-[12.5px]">
        {leaders.length === 0 ? (
          <span style={{ color: "var(--board-ink-dim)" }}>Nobody has been named yet.</span>
        ) : (
          <>
            The league has named {joinNames(leaders.map((row) => row.name))} more than
            anyone: {top} {top === 1 ? "vote" : "votes"}
            {leaders.length > 1 ? " each" : ""}.
          </>
        )}
      </p>

      {rows.length === 0 ? null : (
        <ol className="mt-3 border-t" style={{ borderColor: "var(--board-line)" }}>
          {rows.map((row, i) => (
            <Row key={row.teamId} rank={i + 1} row={row} mine={row.teamId === viewerTeamId} />
          ))}
        </ol>
      )}
    </>
  );
}

/**
 * Who has picked the reader, most often first.
 *
 * Only the people who actually have. An empty list is a result in its own right — the
 * league has never fancied you for last — and it says so rather than drawing a table
 * with nothing in it.
 */
export function Haters({ rows }: { rows: VoteTally[] }) {
  if (rows.length === 0) {
    return (
      <p className="mt-3 text-[12.5px]" style={{ color: "var(--board-ink-dim)" }}>
        Nobody has named you yet.
      </p>
    );
  }

  return (
    <ol className="mt-3 border-t" style={{ borderColor: "var(--board-line)" }}>
      {rows.map((row, i) => (
        <Row key={row.teamId} rank={i + 1} row={row} mine={false} />
      ))}
    </ol>
  );
}
