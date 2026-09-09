import Link from "next/link";
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
  const grid = "grid grid-cols-[24px_1fr_52px_64px] items-center gap-2 px-2";

  return (
    <div className="mt-3 border-t" style={{ borderColor: "var(--board-line)" }}>
      <div
        className={`${grid} py-[5px] text-[10px] uppercase tracking-[0.06em]`}
        style={{ background: "var(--board-panel)", color: "var(--board-ink-dim)" }}
      >
        <span>#</span>
        <span>Manager</span>
        <span className="text-right">Total</span>
        {/* The fourth column is two different measurements, so it says which one it is
            rather than leaving a reader to infer it from the shape of what is under it. */}
        <span className="text-right">{isLive ? "Live" : "Form"}</span>
      </div>

      <ol>
        {rows.map((row) => (
          <li
            key={row.teamId}
            className={`${grid} border-b py-[6px]`}
            style={{
              borderColor: "var(--board-line)",
              background:
                row.teamId === myTeamId
                  ? "color-mix(in srgb, var(--board-you) 10%, transparent)"
                  : undefined,
            }}
          >
            <span
              className="text-[12px] tabular-nums"
              style={{
                fontFamily: "var(--font-mono)",
                color: row.teamId === myTeamId ? "var(--board-you)" : "var(--board-ink-dim)",
              }}
            >
              {row.position}
            </span>
            <span className="min-w-0">
              <span className="flex items-baseline gap-2 min-w-0">
                <Link
                  href={`/teams/${row.teamId}`}
                  className="truncate text-[13px] underline-offset-4 hover:underline"
                >
                  {row.managerName}
                </Link>
                {row.teamId === myTeamId ? (
                  <span
                    aria-label="Your team"
                    className="shrink-0 text-[9.5px] uppercase tracking-[0.1em]"
                    style={{ color: "var(--board-you)" }}
                  >
                    you
                  </span>
                ) : null}
              </span>
              <span className="block text-[10.5px]" style={{ color: "var(--board-ink-dim)" }}>
                {movement(row)}
              </span>
            </span>
            <span
              className="text-right text-[13px] tabular-nums"
              style={{ fontFamily: "var(--font-mono)" }}
            >
              {row.cumulativePoints}
            </span>
            {isLive && row.livePoints !== null ? (
              <span
                className="text-right text-[12px] tabular-nums"
                style={{ fontFamily: "var(--font-mono)", color: "var(--board-gain)" }}
              >
                +{row.livePoints}
              </span>
            ) : (
              <Form points={formByTeam[row.teamId] ?? []} />
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
