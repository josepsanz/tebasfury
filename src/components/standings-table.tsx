import type { TableRow } from "@/lib/domain/standings";

const ordinal = (n: number) => {
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${suffix}`;
};

/** Movement in words. An arrow needs a legend; "up from 3rd" does not. */
function movement(row: TableRow): string {
  if (row.previousPosition === null) return "";
  if (row.previousPosition === row.position) return "no change";
  return row.previousPosition > row.position
    ? `up from ${ordinal(row.previousPosition)}`
    : `down from ${ordinal(row.previousPosition)}`;
}

/** Three bars, the last three gameweeks, tallest is this manager's own best. */
function Form({ points }: { points: number[] }) {
  const best = Math.max(...points, 1);
  return (
    <div className="flex h-5 items-end justify-end gap-[3px]" aria-hidden>
      {points.map((p, i) => (
        <div
          key={i}
          className="w-[7px] rounded-[1px]"
          style={{
            height: `${Math.max(3, Math.round((p / best) * 20))}px`,
            background: p === best ? "var(--board-form-best)" : "var(--board-form)",
          }}
        />
      ))}
    </div>
  );
}

export function StandingsTable({
  rows,
  formByTeam,
  isLive,
  myTeamId,
}: {
  rows: TableRow[];
  formByTeam: Record<string, number[]>;
  isLive: boolean;
  myTeamId?: string | null;
}) {
  return (
    <ol className="mt-4">
      {rows.map((row) => (
        <li
          key={row.teamId}
          className="grid grid-cols-[46px_1fr_auto_88px] items-center gap-3 border-b py-[11px]"
          style={{ borderColor: "var(--board-line)" }}
        >
          <span
            className="text-[27px] font-extralight leading-none tabular-nums"
            style={{
              fontFamily: "var(--font-barlow-condensed)",
              opacity: row.position === 1 ? 1 : 0.42,
            }}
          >
            {row.position}
          </span>
          <span className="min-w-0">
            <span className="flex items-baseline gap-2 min-w-0">
              <span className="truncate text-[14.5px]">{row.managerName}</span>
              {row.teamId === myTeamId ? (
                <span
                  aria-label="Your team"
                  className="shrink-0 text-[10px] uppercase tracking-[0.1em]"
                  style={{ color: "var(--board-ink-dim)" }}
                >
                  you
                </span>
              ) : null}
            </span>
            <span className="block text-[11px]" style={{ color: "var(--board-ink-dim)" }}>
              {movement(row)}
            </span>
          </span>
          <span
            className="text-[20px] font-normal tabular-nums"
            style={{ fontFamily: "var(--font-barlow-condensed)" }}
          >
            {row.cumulativePoints}
          </span>
          {isLive && row.livePoints !== null ? (
            <span
              className="text-right text-[12px] tabular-nums"
              style={{ color: "var(--board-gain)" }}
            >
              +{row.livePoints}
            </span>
          ) : (
            <Form points={formByTeam[row.teamId] ?? []} />
          )}
        </li>
      ))}
    </ol>
  );
}
