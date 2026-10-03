import Link from "next/link";
import { ClauseName } from "@/components/clause-marks";
import { formatMoney } from "@/lib/domain/players";
import type { Lens, Route, Tag, Target } from "@/lib/domain/targets";

const ROUTE_LABEL: Record<Route, string> = { auction: "Auction", listed: "Listed", clause: "Clause" };

const TONE: Record<Tag["tone"], string> = {
  positive: "var(--board-gain)",
  warning: "var(--board-alert)",
  info: "var(--board-free)",
};

const percent = (x: number | null) => (x === null ? "—" : `${x >= 0 ? "+" : "−"}${Math.round(Math.abs(x) * 100)}%`);
const perDay = (x: number) => `${x >= 0 ? "+" : "−"}${formatMoney(Math.abs(x))}/d`;
const score = (t: Target, lens: Lens) =>
  lens === "investment" ? percent(t.investment) : t.performance === null ? "—" : t.performance.toFixed(2);

/**
 * The ranked targets for one lens.
 *
 * Each row carries its reason beside its rank: the route and what it really costs (with its
 * multiple of market value, and "house rule" on a listing so nobody reads the +10% as
 * LaLiga's), the week's growth, the tags, and the active lens's score. A score that cannot
 * be worked out is a dash, never a zero.
 */
export function TargetList({ rows, lens }: { rows: Target[]; lens: Lens }) {
  if (rows.length === 0) {
    return (
      <p className="mt-6" style={{ color: "var(--board-ink-dim)" }}>
        Nobody matches that. Clear a filter to widen it.
      </p>
    );
  }
  return (
    <>
      <div
        className="mt-3 grid grid-cols-[1fr_64px_56px] gap-3 border-y px-2 py-[5px] text-[10px] uppercase tracking-[0.06em]"
        style={{ borderColor: "var(--board-line)", background: "var(--board-panel)", color: "var(--board-ink-dim)" }}
      >
        <span>Player · route · cost</span>
        <span className="text-right">7 days</span>
        <span className="text-right">{lens === "investment" ? "Return" : "Pts / M"}</span>
      </div>
      <ol>
        {rows.map((t, i) => (
          <li key={t.playerId} className="border-b" style={{ borderColor: "var(--board-line)" }}>
            <Link href={`/players/${t.playerId}`} className="grid grid-cols-[1fr_64px_56px] items-start gap-3 px-2 py-[6px]">
              <span className="min-w-0">
                <span className="flex items-baseline gap-2">
                  <span className="text-[10.5px] tabular-nums" style={{ fontFamily: "var(--font-mono)", color: "var(--board-ink-dim)" }}>
                    {i + 1}
                  </span>
                  <ClauseName clause={t.clause ?? undefined}>{t.nickname}</ClauseName>
                </span>
                <span className="block truncate text-[10.5px]" style={{ color: "var(--board-ink-dim)" }}>
                  {t.position} · {t.ownerName ?? "Free"} · {t.route ? ROUTE_LABEL[t.route] : ""}{" "}
                  {t.cost === null ? "" : formatMoney(t.cost)}
                  {t.costMultiple === null ? "" : ` · ${t.costMultiple.toFixed(2)}×${t.route === "listed" ? " house rule" : ""}`}
                </span>
                {t.tags.length === 0 ? null : (
                  <span className="mt-[3px] flex flex-wrap gap-1">
                    {t.tags.map((tag) => (
                      <span key={tag.key} className="border px-[5px] text-[10px]" style={{ color: TONE[tag.tone], borderColor: "var(--board-line)" }}>
                        {tag.label}
                      </span>
                    ))}
                  </span>
                )}
              </span>
              <span className="text-right text-[12px] tabular-nums" style={{ fontFamily: "var(--font-mono)" }}>
                {percent(t.growth7)}
                {/* The same week in money: per place in the squad, where the percentage is per
                    euro. Context only — the score beside it never reads it. */}
                {t.gainPerDay7 === null ? null : (
                  <span className="block text-[10px]" style={{ color: "var(--board-ink-dim)" }}>
                    {perDay(t.gainPerDay7)}
                  </span>
                )}
              </span>
              <span className="text-right text-[13px] font-semibold tabular-nums" style={{ fontFamily: "var(--font-mono)" }}>
                {score(t, lens)}
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </>
  );
}

/**
 * Owned players nobody can take today, folded away and counted.
 *
 * A native `<details>`, closed by default: they are context, not candidates, and they are
 * about half the league. A shield gets its word and its mark but no countdown, because the
 * API gives none.
 */
export function LockedTargets({ rows }: { rows: Target[] }) {
  if (rows.length === 0) return null;
  return (
    <details className="mt-6">
      <summary className="cursor-pointer text-[11.5px]" style={{ color: "var(--board-ink-dim)" }}>
        Locked — no route open ({rows.length})
      </summary>
      <ol className="mt-2">
        {rows.map((t) => (
          <li key={t.playerId} className="border-b px-2 py-[5px]" style={{ borderColor: "var(--board-line)" }}>
            <Link href={`/players/${t.playerId}`} className="block">
              <ClauseName clause={t.clause ?? undefined}>{t.nickname}</ClauseName>
              <span className="block text-[10.5px]" style={{ color: "var(--board-ink-dim)" }}>
                {t.position} · {t.ownerName} · {t.clause?.state === "shielded" ? "Shielded" : t.clause?.label}
                {t.clause?.shielded && t.clause.state !== "shielded" ? " · Shielded" : ""}
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </details>
  );
}
