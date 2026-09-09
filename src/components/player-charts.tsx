"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatMoney, pointsTrend, valueTrend, type ValuePoint } from "@/lib/domain/players";
import { formatTrend, formatValueTrend } from "@/lib/domain/metric-copy";

type PointsPoint = { gameweek: number; points: number | null };

const AXIS = { stroke: "var(--board-ink-dim)", fontSize: 11 };

/**
 * The hover readout, in the board's own surface rather than Recharts' white default.
 *
 * A null is drawn as "—", never as 0: a gameweek the player did not feature in and a
 * gameweek he scored nothing are different facts, and `Number(null)` being `0` is
 * exactly the false reading the progress charts already had to fix once.
 */
function Readout({
  active,
  label,
  value,
  caption,
  format,
}: {
  active?: boolean;
  label?: string | number;
  value: number | null | undefined;
  caption: string;
  format: (v: number) => string;
}) {
  if (!active) return null;
  return (
    <div
      style={{
        background: "var(--board-bg)",
        border: "1px solid var(--board-line)",
        fontSize: 12,
        padding: "6px 9px",
      }}
    >
      <p style={{ margin: 0, color: "var(--board-ink-dim)" }}>
        {caption} {label}
      </p>
      <p style={{ margin: "3px 0 0", fontFamily: "var(--font-mono)" }}>
        {value === null || value === undefined ? "—" : format(value)}
      </p>
    </div>
  );
}

/** A trend beside a chart title, in the two words the portal uses for direction. */
function TrendNote({ value, tone }: { value: string; tone?: "up" | "down" }) {
  return (
    <span
      className="ml-3 text-[12px] tabular-nums"
      style={{
        fontFamily: "var(--font-mono)",
        color:
          tone === "up"
            ? "var(--board-gain)"
            : tone === "down"
              ? "var(--board-alert)"
              : "var(--board-ink-dim)",
      }}
    >
      {value}
    </span>
  );
}

function Empty() {
  return (
    <p className="mt-2 text-[13px]" style={{ color: "var(--board-ink-dim)" }}>
      Nothing has been swept yet.
    </p>
  );
}

function Numbers({
  head,
  rowLabel,
  rows,
}: {
  head: string;
  rowLabel: string;
  rows: [string, string][];
}) {
  return (
    <details className="mt-3">
      <summary className="cursor-pointer text-[12px]" style={{ color: "var(--board-ink-dim)" }}>
        Show the numbers
      </summary>
      <div className="mt-2 overflow-x-auto">
        <table className="text-[12px] tabular-nums">
          <thead>
            <tr>
              <th className="px-2 py-1 text-left font-medium">{head}</th>
              {rows.map(([label]) => (
                <th key={label} className="px-2 py-1 text-right font-medium">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="px-2 py-1">{rowLabel}</td>
              {rows.map(([label, value]) => (
                <td key={label} className="px-2 py-1 text-right">
                  {value}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </details>
  );
}

export function PlayerCharts({ points, values }: { points: PointsPoint[]; values: ValuePoint[] }) {
  return (
    <div className="space-y-12">
      <section>
        <h2 className="text-[15px] font-medium">
          Points per gameweek
          <TrendNote {...formatTrend(pointsTrend(points))} />
        </h2>
        {points.length === 0 ? (
          <Empty />
        ) : (
          <>
            <div className="mt-3 h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={points}>
                  <CartesianGrid stroke="var(--board-line)" vertical={false} />
                  <XAxis dataKey="gameweek" {...AXIS} tickLine={false} />
                  <YAxis {...AXIS} tickLine={false} width={28} />
                  <Tooltip
                    cursor={{ fill: "var(--board-panel)" }}
                    content={(props) => (
                      <Readout
                        active={props.active}
                        label={props.label as number}
                        value={props.payload?.[0]?.value as number | null | undefined}
                        caption="Gameweek"
                        format={(v) => `${v} pts`}
                      />
                    )}
                  />
                  <Bar dataKey="points" fill="var(--board-form-best)" radius={[1, 1, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <Numbers
              head="Gameweek"
              rowLabel="Points"
              rows={points.map((p) => [
                String(p.gameweek),
                p.points === null ? "—" : String(p.points),
              ])}
            />
          </>
        )}
      </section>

      <section>
        <h2 className="text-[15px] font-medium">
          Market value
          <TrendNote {...formatValueTrend(valueTrend(values))} />
        </h2>
        <p className="mt-1 text-[12px]" style={{ color: "var(--board-ink-dim)" }}>
          Market value is only recorded from the first sweep onward. LaLiga publishes no
          history, so the days before it cannot be recovered.
        </p>
        {values.length === 0 ? (
          <Empty />
        ) : (
          <>
            <div className="mt-3 h-56">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={values}>
                  <CartesianGrid stroke="var(--board-line)" vertical={false} />
                  <XAxis dataKey="takenOn" {...AXIS} tickLine={false} />
                  <YAxis
                    {...AXIS}
                    tickLine={false}
                    width={44}
                    domain={["auto", "auto"]}
                    tickFormatter={(v: number) => formatMoney(v)}
                  />
                  <Tooltip
                    cursor={{ stroke: "var(--board-line)" }}
                    content={(props) => (
                      <Readout
                        active={props.active}
                        label={props.label as string}
                        value={props.payload?.[0]?.value as number | null | undefined}
                        caption=""
                        format={formatMoney}
                      />
                    )}
                  />
                  {/* Straight segments: one reading per day, and the days between two sweeps
                      hold no value at all — a curve would invent them. */}
                  <Line
                    type="linear"
                    dataKey="value"
                    stroke="var(--series-1)"
                    strokeWidth={2}
                    dot={values.length === 1}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <Numbers
              head="Day"
              rowLabel="Value"
              rows={values.map((v) => [v.takenOn, formatMoney(v.value)])}
            />
          </>
        )}
      </section>
    </div>
  );
}
