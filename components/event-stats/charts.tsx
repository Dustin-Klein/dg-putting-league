'use client';

import { useState } from 'react';
import { zoneColorValue } from '@/components/zone-badge';
import { formatRate } from './format';

/**
 * Small hand-written charts for the event report. Single hue (the info token) for
 * magnitude; the putts mix steps that hue light → dark because 0–3 made is ordered.
 * Every chart has a text equivalent next to it (legend counts or a table).
 */

const MIX_OPACITY = [0.25, 0.5, 0.75, 1];
export const MIX_LABELS = ['0 made', '1 made', '2 made', '3 made'];

/** Frames by putts made as one stacked bar, with 2px gaps between segments. */
export function PuttsMixBar({ mix, label }: { mix: readonly number[]; label: string }) {
  const total = mix.reduce((a, b) => a + b, 0);
  const [hover, setHover] = useState<number | null>(null);
  if (total === 0) return null;
  const aria = `${label}: ` + mix.map((count, i) => `${MIX_LABELS[i]} ${count} (${formatRate(count / total)})`).join(', ');
  return (
    <div className="flex flex-col gap-2">
      <div role="img" aria-label={aria} className="flex h-6 w-full gap-[2px] overflow-hidden rounded">
        {mix.map((count, i) =>
          count === 0 ? null : (
            <div
              key={i}
              className="relative h-full first:rounded-l last:rounded-r"
              style={{ flexGrow: count, flexBasis: 0, background: 'hsl(var(--info))', opacity: hover === null || hover === i ? MIX_OPACITY[i] : MIX_OPACITY[i] * 0.5 }}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              title={`${MIX_LABELS[i]}: ${count} frames (${formatRate(count / total)})`}
            />
          )
        )}
      </div>
      <ul className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {mix.map((count, i) => (
          <li key={i} className="flex items-center gap-1.5">
            <span className="inline-block size-2.5 rounded-sm" style={{ background: 'hsl(var(--info))', opacity: MIX_OPACITY[i] }} aria-hidden="true" />
            <span className="whitespace-nowrap">{MIX_LABELS[i]}</span>
            <span className="ml-auto whitespace-nowrap tabular-nums text-foreground">{count} · {formatRate(count / total)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Winning margin histogram: one bar per margin, close matches (≤ 2) called out in the axis. */
export function MarginHistogram({ margins }: { margins: readonly { margin: number; count: number }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  if (margins.length === 0) return <p className="text-sm text-muted-foreground">No completed matches yet.</p>;
  const max = Math.max(...margins.map((m) => m.count));
  const width = 100 / margins.length;
  const aria = 'Matches by winning margin: ' + margins.filter((m) => m.count > 0).map((m) => `${m.margin} points: ${m.count}`).join(', ');
  return (
    <div className="flex flex-col gap-1">
      <div role="img" aria-label={aria} className="relative h-36 w-full">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible" aria-hidden="true">
          <line x1="0" x2="100" y1="100" y2="100" stroke="hsl(var(--border))" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          {margins.map((m, i) => {
            const h = max > 0 ? (m.count / max) * 92 : 0;
            return (
              <g key={m.margin} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                <rect x={i * width} y="0" width={width} height="100" fill="transparent" />
                {m.count > 0 && (
                  <rect
                    x={i * width + width * 0.12}
                    y={100 - h}
                    width={width * 0.76}
                    height={h}
                    rx="0.8"
                    fill="hsl(var(--info))"
                    opacity={hover === null || hover === i ? 1 : 0.55}
                  >
                    <title>{`${m.margin} point${m.margin === 1 ? '' : 's'}: ${m.count} match${m.count === 1 ? '' : 'es'}`}</title>
                  </rect>
                )}
              </g>
            );
          })}
        </svg>
        {hover !== null && margins[hover].count > 0 && (
          <span
            className="pointer-events-none absolute -translate-x-1/2 rounded-md border bg-popover px-2 py-1 text-xs whitespace-nowrap text-popover-foreground shadow"
            style={{ left: `${(hover + 0.5) * width}%`, top: 0 }}
          >
            {margins[hover].margin} pts · {margins[hover].count} match{margins[hover].count === 1 ? '' : 'es'}
          </span>
        )}
      </div>
      <div className="flex text-[11px] tabular-nums text-muted-foreground" aria-hidden="true">
        {margins.map((m) => (
          <span key={m.margin} className="text-center" style={{ width: `${width}%` }}>
            {margins.length <= 16 || m.margin % 2 === 0 ? m.margin : ''}
          </span>
        ))}
      </div>
    </div>
  );
}

export interface ScatterPoint {
  id: string;
  label: string;
  zone: number | null;
  x: number;
  y: number;
}

/** Season make % (x) vs. this event (y), with the y = x reference line. Admin only. */
export function SeasonScatter({ points }: { points: readonly ScatterPoint[] }) {
  const [hover, setHover] = useState<string | null>(null);
  if (points.length === 0) return <p className="text-sm text-muted-foreground">No player has 10 frames both this event and in the season baseline.</p>;
  const values = points.flatMap((p) => [p.x, p.y]);
  const lo = Math.max(0, Math.floor((Math.min(...values) - 0.05) * 10) / 10);
  const hi = Math.min(1, Math.ceil((Math.max(...values) + 0.05) * 10) / 10);
  const scale = (v: number) => ((v - lo) / (hi - lo || 1)) * 100;
  const active = points.find((p) => p.id === hover);
  return (
    <div className="flex flex-col gap-2">
      <div className="relative aspect-square w-full max-w-[360px]">
        <svg viewBox="-2 -2 104 104" className="absolute inset-0 h-full w-full overflow-visible" role="img"
          aria-label={`Season make % against this event's make % for ${points.length} players`}>
          <rect x="0" y="0" width="100" height="100" fill="none" stroke="hsl(var(--border))" strokeWidth="0.5" />
          <line x1="0" y1="100" x2="100" y2="0" stroke="hsl(var(--muted-foreground))" strokeWidth="0.5" strokeDasharray="2 2" />
          {points.map((p) => (
            <circle
              key={p.id}
              cx={scale(p.x)}
              cy={100 - scale(p.y)}
              r={hover === p.id ? 3 : 2.2}
              fill={p.zone !== null ? zoneColorValue(p.zone) : 'hsl(var(--info))'}
              stroke="hsl(var(--card))"
              strokeWidth="0.6"
              onMouseEnter={() => setHover(p.id)}
              onMouseLeave={() => setHover(null)}
            >
              <title>{`${p.label}: season ${formatRate(p.x)}, this event ${formatRate(p.y)}`}</title>
            </circle>
          ))}
        </svg>
        {active && (
          <span
            className="pointer-events-none absolute -translate-x-1/2 -translate-y-full rounded-md border bg-popover px-2 py-1 text-xs whitespace-nowrap text-popover-foreground shadow"
            style={{ left: `${scale(active.x)}%`, top: `${100 - scale(active.y)}%` }}
          >
            {active.label} · season {formatRate(active.x)} · event {formatRate(active.y)}
          </span>
        )}
      </div>
      <div className="flex max-w-[360px] justify-between text-[11px] text-muted-foreground">
        <span>{formatRate(lo)}</span>
        <span>Season make % → (event make % ↑; dashed line: same as season)</span>
        <span>{formatRate(hi)}</span>
      </div>
    </div>
  );
}
