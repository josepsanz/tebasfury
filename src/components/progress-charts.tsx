"use client";

import { useState } from "react";
import {
  CartesianGrid,
  Customized,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { TooltipProps } from "recharts";
import type { Series, TeamRef } from "@/lib/domain/standings";

const PINNED_COLOURS = ["var(--series-1)", "var(--series-2)", "var(--series-3)"];

type ChartSpec = {
  key: keyof Series;
  title: string;
  invert?: boolean;
  format?: (v: number) => string;
};

const CHARTS: ChartSpec[] = [
  { key: "pointsPerWeek", title: "Points per gameweek" },
  { key: "cumulativePoints", title: "Cumulative points" },
  { key: "tablePosition", title: "Table position", invert: true },
  {
    key: "teamValue",
    title: "Team value",
    format: (v) => `${(v / 1_000_000).toFixed(1)}M`,
  },
];

// One slot per palette colour — that cap is the whole reason the palette is legal.
const EMPTY_PINS: (string | null)[] = PINNED_COLOURS.map(() => null);

/**
 * A manager's colour is `PINNED_COLOURS[pinned.indexOf(teamId)]`, so the slot a
 * manager occupies must never move once assigned — pinning and unpinning must
 * not repaint the survivors. Modelling `pinned` as three fixed slots (rather
 * than a list that shifts on removal) is what makes that true: unpinning clears
 * a manager's own slot to `null` and leaves every other slot exactly where it
 * was. Extracted so this property can be unit tested directly.
 */
export function applyPin(current: (string | null)[], teamId: string): (string | null)[] {
  const slot = current.indexOf(teamId);
  if (slot !== -1) {
    const next = [...current];
    next[slot] = null;
    return next;
  }
  const free = current.indexOf(null);
  if (free === -1) return current; // all three slots taken
  const next = [...current];
  next[free] = teamId;
  return next;
}

export function ProgressCharts({ series, teams }: { series: Series; teams: TeamRef[] }) {
  const [pinned, setPinned] = useState<(string | null)[]>(EMPTY_PINS);

  const toggle = (teamId: string) => setPinned((current) => applyPin(current, teamId));

  return (
    <div className="space-y-12">
      <div className="flex flex-wrap gap-2">
        {teams.map((team) => {
          const index = pinned.indexOf(team.id);
          return (
            <button
              key={team.id}
              type="button"
              onClick={() => toggle(team.id)}
              aria-pressed={index !== -1}
              className="rounded-full border px-3 py-1 text-[12px]"
              style={{
                borderColor: index === -1 ? "var(--board-line)" : PINNED_COLOURS[index],
                color: index === -1 ? "var(--board-ink-dim)" : "var(--board-ink)",
              }}
            >
              {team.managerName}
            </button>
          );
        })}
      </div>
      {pinned.every((id) => id !== null) && (
        <p className="-mt-8 text-[12px]" style={{ color: "var(--board-ink-dim)" }}>
          Three at a time. Unpin one to compare someone else.
        </p>
      )}

      {CHARTS.map((spec) => (
        <ChartBlock key={spec.key} spec={spec} points={series[spec.key]} teams={teams} pinned={pinned} />
      ))}
    </div>
  );
}

type Row = { gameweek: number } & Record<string, number | null>;

/** Recharts wants one row per x value with a column per series. */
function toRows(points: { teamId: string; gameweek: number; value: number | null }[]): Row[] {
  const byWeek = new Map<number, Row>();
  for (const p of points) {
    const row = byWeek.get(p.gameweek) ?? ({ gameweek: p.gameweek } as Row);
    row[p.teamId] = p.value;
    byWeek.set(p.gameweek, row);
  }
  return [...byWeek.values()].sort((a, b) => a.gameweek - b.gameweek);
}

/**
 * Recharts declares a tooltip payload's `value` as `number` (never `null`), but a
 * real gap in the underlying series — a team value before its first sync, say,
 * since that series only accumulates forward — does come through as `null` at
 * runtime, not `undefined`. Treating only `undefined` as "absent" turned a
 * genuine gap into a false "0.0M": `Number(null)` is `0`, which reads as a real
 * measurement. Extracted so this distinction can be unit tested directly.
 */
export function formatTooltipValue(
  raw: number | null | undefined,
  format: (v: number) => string,
): string {
  return raw === null || raw === undefined ? "—" : format(raw);
}

/**
 * The tooltip content, restricted to pinned managers.
 *
 * Thirteen rows of tooltip is unreadable, so unpinned lines carry no identity
 * here either — only a manager who has been pinned (and so already has a
 * colour and an end label) gets a row.
 */
function ChartTooltip({
  active,
  payload,
  label,
  pinned,
  nameOf,
  format,
}: TooltipProps<number, string> & {
  pinned: (string | null)[];
  nameOf: (teamId: string) => string;
  format: (v: number) => string;
}) {
  if (!active || !payload || payload.length === 0) return null;

  const rows = payload
    .filter((p): p is typeof p & { dataKey: string } => typeof p.dataKey === "string" && pinned.includes(p.dataKey))
    .sort((a, b) => Number(b.value ?? 0) - Number(a.value ?? 0));
  if (rows.length === 0) return null;

  return (
    <div
      style={{
        background: "var(--board-bg)",
        border: "1px solid var(--board-line)",
        fontSize: 12,
        padding: "8px 10px",
      }}
    >
      <p style={{ margin: 0, color: "var(--board-ink-dim)" }}>Gameweek {label}</p>
      {rows.map((p) => (
        <p key={p.dataKey} style={{ margin: "4px 0 0", color: PINNED_COLOURS[pinned.indexOf(p.dataKey)] }}>
          {nameOf(p.dataKey)}: {formatTooltipValue(p.value as number | null | undefined, format)}
        </p>
      ))}
    </div>
  );
}

const END_LABEL_MAX_CHARS = 14;

/**
 * A manager's name can be arbitrarily long; the end label has a fixed margin
 * to draw in regardless of chart width (mobile especially), so a long name is
 * shortened. Identity is still established — the pin buttons and the tooltip
 * both carry the full name — this is only the space-constrained repeat of it.
 */
function shortenForLabel(name: string): string {
  return name.length > END_LABEL_MAX_CHARS
    ? `${name.slice(0, END_LABEL_MAX_CHARS - 1).trimEnd()}…`
    : name;
}

const LABEL_MIN_GAP_PX = 14;

/** The slice of Recharts' internal chart state a `Customized` overlay needs. */
type ChartInternals = {
  yAxisMap?: Record<string, { scale?: (value: number) => number }>;
  offset?: { left: number; width: number };
};

/**
 * Draws every pinned line's end label together, in one overlay, instead of each
 * line labelling itself independently.
 *
 * This is required, not decorative: the tritan separation between two of the three
 * pinned colours is low, so the label is the secondary encoding that makes the
 * palette legal — colour alone must never carry identity. Labelling per-line meant
 * two managers who finish close in value got overlapping, unreadable labels; doing
 * it once here, with the chart's real y-scale (via Recharts' `Customized`, the
 * documented escape hatch for exactly this), means every label can be pushed apart
 * to a minimum gap before being drawn.
 */
function EndLabels({
  pinned,
  rows,
  lastIndex,
  nameOf,
}: {
  pinned: (string | null)[];
  rows: Row[];
  lastIndex: number;
  nameOf: (teamId: string) => string;
}) {
  return function Overlay(props: ChartInternals) {
    const scale = Object.values(props.yAxisMap ?? {})[0]?.scale;
    const offset = props.offset;
    if (!scale || !offset) return null;

    const last = rows[lastIndex];
    const x = offset.left + offset.width + 8;

    const items = pinned
      .map((teamId, index) => {
        if (teamId === null) return null;
        const value = last[teamId];
        return value === null || value === undefined
          ? null
          : { teamId, y: scale(value), colour: PINNED_COLOURS[index], label: shortenForLabel(nameOf(teamId)) };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null)
      .sort((a, b) => a.y - b.y);

    // Decluttering: push each label down until it clears the one above it.
    for (let i = 1; i < items.length; i++) {
      if (items[i].y - items[i - 1].y < LABEL_MIN_GAP_PX) {
        items[i].y = items[i - 1].y + LABEL_MIN_GAP_PX;
      }
    }

    return (
      <g>
        {items.map((item) => (
          <text key={item.teamId} x={x} y={item.y + 4} fill={item.colour} fontSize={11}>
            {item.label}
          </text>
        ))}
      </g>
    );
  };
}

function ChartBlock({
  spec,
  points,
  teams,
  pinned,
}: {
  spec: ChartSpec;
  points: { teamId: string; gameweek: number; value: number | null }[];
  teams: TeamRef[];
  pinned: (string | null)[];
}) {
  const rows = toRows(points);
  const nameOf = (teamId: string) => teams.find((t) => t.id === teamId)?.managerName ?? teamId;
  const format = spec.format ?? ((v: number) => String(v));

  if (rows.length === 0) {
    return (
      <div>
        <h2 className="text-lg font-medium">{spec.title}</h2>
        <p className="mt-2 text-[13px]" style={{ color: "var(--board-ink-dim)" }}>
          {spec.key === "teamValue"
            ? "Team value only accumulates from the first sync onward — the API reports it as current state, so past gameweeks have none. This fills in one gameweek at a time."
            : "Nothing has synced yet."}
        </p>
      </div>
    );
  }

  const lastIndex = rows.length - 1;
  const unpinned = teams.filter((t) => !pinned.includes(t.id));

  return (
    <div>
      <h2 className="text-lg font-medium">{spec.title}</h2>
      <div className="mt-3 h-[260px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 8, right: 96, bottom: 4, left: 4 }}>
            <CartesianGrid stroke="var(--board-line)" vertical={false} />
            <XAxis
              dataKey="gameweek"
              stroke="var(--board-line)"
              tick={{ fill: "var(--board-ink-dim)", fontSize: 11 }}
            />
            <YAxis
              reversed={spec.invert}
              domain={spec.invert ? [1, teams.length] : undefined}
              stroke="var(--board-line)"
              tick={{ fill: "var(--board-ink-dim)", fontSize: 11 }}
              tickFormatter={(v: number) => format(v)}
            />
            <Tooltip<number, string>
              cursor={{ stroke: "var(--board-line)" }}
              content={(props) => (
                <ChartTooltip {...props} pinned={pinned} nameOf={nameOf} format={format} />
              )}
            />

            {/* Context first, so pinned lines draw on top of it. */}
            {unpinned.map((team) => (
              <Line
                key={team.id}
                type="monotone"
                dataKey={team.id}
                stroke="var(--board-ink-dim)"
                strokeOpacity={0.22}
                strokeWidth={1}
                dot={false}
                activeDot={false}
                isAnimationActive={false}
                connectNulls
              />
            ))}

            {pinned.map((teamId, index) => {
              if (teamId === null) return null;
              const colour = PINNED_COLOURS[index];
              return (
                <Line
                  key={teamId}
                  type="monotone"
                  dataKey={teamId}
                  stroke={colour}
                  strokeWidth={2}
                  dot={{ r: 4, fill: colour, stroke: "var(--board-bg)", strokeWidth: 2 }}
                  isAnimationActive={false}
                  connectNulls
                />
              );
            })}

            <Customized component={EndLabels({ pinned, rows, lastIndex, nameOf })} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <details className="mt-2" aria-label={`Show the numbers for ${spec.title}`}>
        <summary className="cursor-pointer text-[12px]" style={{ color: "var(--board-ink-dim)" }}>
          Show the numbers
        </summary>
        <div className="mt-2 overflow-x-auto">
          <table className="text-[12px] tabular-nums">
            <thead>
              <tr>
                <th className="px-2 py-1 text-left font-medium">Manager</th>
                {rows.map((r) => (
                  <th key={r.gameweek} className="px-2 py-1 text-right font-medium">
                    {r.gameweek}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {teams.map((team) => (
                <tr key={team.id}>
                  <td className="px-2 py-1">{team.managerName}</td>
                  {rows.map((r) => {
                    const v = r[team.id];
                    return (
                      <td key={r.gameweek} className="px-2 py-1 text-right">
                        {v === null || v === undefined ? "—" : format(Number(v))}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
