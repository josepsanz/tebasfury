"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";
import { formatMoney, type ValuePoint } from "@/lib/domain/players";

type PointsPoint = { gameweek: number; points: number | null };

const AXIS = { stroke: "var(--board-ink-dim)", fontSize: 11 };

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
        <h2 className="text-[15px] font-medium">Points per gameweek</h2>
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
        <h2 className="text-[15px] font-medium">Market value</h2>
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
