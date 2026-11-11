'use client';

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { zoneColorValue } from '@/components/zone-badge';
import type { ZoneDefinition, ZoneSeedCandidate } from '@/lib/types/handicap';
import { binCandidates, clampCuts, CUT_STEP, SCORE_MAX, splitBin } from '@/lib/utils/zone-cuts';

const HEIGHT = 240;
const MARGIN = { top: 24, right: 12, bottom: 38, left: 28 };
const PLOT_HEIGHT = HEIGHT - MARGIN.top - MARGIN.bottom;
/** A score exactly on a cut can have a zero-width part; it still has to show. */
const MIN_PART_PX = 3;
const X_TICKS = [0, 5, 10, 15, 20];

function topRounded(x: number, y: number, width: number, height: number): string {
  const r = Math.min(3, width / 2, height);
  const bottom = y + height;
  return `M${x},${bottom}V${y + r}Q${x},${y} ${x + r},${y}H${x + width - r}Q${x + width},${y} ${x + width},${y + r}V${bottom}Z`;
}

/** Past scoring with draggable cut lines. The numeric inputs are the fallback for touch and precision. */
export function ZoneCutHistogram({
  candidates,
  cuts,
  zones,
  defaultZone,
  onCutsChange,
}: {
  candidates: ZoneSeedCandidate[];
  cuts: number[];
  zones: ZoneDefinition[];
  defaultZone: number;
  onCutsChange: (cuts: number[]) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hovered, setHovered] = useState<number | null>(null);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const bins = useMemo(() => binCandidates(candidates), [candidates]);
  const rows = useMemo(
    () => bins.map((bin) => ({ bin, parts: splitBin(bin, cuts, zones, defaultZone) })),
    [bins, cuts, zones, defaultZone]
  );

  const plotWidth = Math.max(0, width - MARGIN.left - MARGIN.right);
  const x = (score: number) => MARGIN.left + (score / SCORE_MAX) * plotWidth;
  const stackOf = (row: (typeof rows)[number]) =>
    Math.max(0, ...row.parts.map((part) => part.count)) + row.bin.ineligible.length;
  const tallest = Math.max(1, ...rows.map(stackOf));
  const tickStep = Math.max(1, Math.ceil(tallest / 4));
  const yMax = Math.ceil(tallest / tickStep) * tickStep;
  const yTicks = Array.from({ length: yMax / tickStep + 1 }, (_, i) => i * tickStep);
  const barHeight = (count: number) => (count / yMax) * PLOT_HEIGHT;
  const baseline = MARGIN.top + PLOT_HEIGHT;

  const moveCut = (index: number, value: number) =>
    onCutsChange(clampCuts(cuts.map((cut, i) => (i === index ? value : cut)), index));

  const dragTo = (index: number, event: PointerEvent<HTMLDivElement>) => {
    const left = containerRef.current?.getBoundingClientRect().left ?? 0;
    if (plotWidth > 0) moveCut(index, ((event.clientX - left - MARGIN.left) / plotWidth) * SCORE_MAX);
  };

  const onHandleKey = (index: number, event: KeyboardEvent<HTMLDivElement>) => {
    const direction = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1 }[event.key];
    if (!direction) return;
    event.preventDefault();
    moveCut(index, cuts[index] + direction * (event.shiftKey ? 1 : CUT_STEP));
  };

  const hoveredRow = hovered === null ? null : rows[hovered];

  return (
    <div className="flex flex-col gap-3">
      <div ref={containerRef} className="relative select-none" style={{ height: HEIGHT }}>
        {width > 0 && (
          <>
            <svg width={width} height={HEIGHT} role="img" aria-label="Players by average points per 5-frame match. The Review table lists the same data.">
              {zones.map((zone, i) => {
                const from = x(i > 0 ? cuts[i - 1] : 0);
                const to = x(i < cuts.length ? cuts[i] : SCORE_MAX);
                return (
                  <g key={zone.zone}>
                    <rect
                      x={from}
                      y={MARGIN.top}
                      width={Math.max(0, to - from)}
                      height={PLOT_HEIGHT}
                      style={{ fill: zoneColorValue(zone.zone) }}
                      opacity={0.12}
                    />
                    {to - from >= 48 && (
                      <text x={(from + to) / 2} y={MARGIN.top - 8} textAnchor="middle" className="fill-muted-foreground text-[11px] font-bold">
                        Zone {zone.zone}
                      </text>
                    )}
                  </g>
                );
              })}

              {yTicks.map((tick) => (
                <g key={tick}>
                  <line
                    x1={MARGIN.left}
                    x2={MARGIN.left + plotWidth}
                    y1={baseline - barHeight(tick)}
                    y2={baseline - barHeight(tick)}
                    className="stroke-border"
                    strokeWidth={1}
                  />
                  <text x={MARGIN.left - 6} y={baseline - barHeight(tick) + 3.5} textAnchor="end" className="fill-muted-foreground text-[10px] tabular-nums">
                    {tick}
                  </text>
                </g>
              ))}
              {X_TICKS.map((tick) => (
                <text key={tick} x={x(tick)} y={baseline + 14} textAnchor="middle" className="fill-muted-foreground text-[10px] tabular-nums">
                  {tick}
                </text>
              ))}
              <text x={MARGIN.left + plotWidth / 2} y={HEIGHT - 6} textAnchor="middle" className="fill-muted-foreground text-[11px]">
                Average points per 5-frame match
              </text>

              {rows.map((row) => {
                const tallestPart = Math.max(0, ...row.parts.map((part) => part.count));
                const faint = row.bin.ineligible.length;
                return (
                  <g key={row.bin.from}>
                    {row.parts.map((part) => {
                      const left = x(part.from) + 1;
                      const partWidth = Math.max(MIN_PART_PX, x(part.to) - x(part.from) - 2);
                      const height = barHeight(part.count);
                      return (
                        <path
                          key={part.zone}
                          d={topRounded(left, baseline - height, partWidth, height)}
                          style={{ fill: zoneColorValue(part.zone) }}
                        />
                      );
                    })}
                    {faint > 0 && (
                      <path
                        d={topRounded(
                          x(row.bin.from) + 1,
                          baseline - barHeight(tallestPart + faint),
                          Math.max(MIN_PART_PX, x(row.bin.to) - x(row.bin.from) - 2),
                          barHeight(faint) - (tallestPart > 0 ? 2 : 0)
                        )}
                        className="fill-muted-foreground"
                        opacity={0.35}
                      />
                    )}
                  </g>
                );
              })}

              {rows.map((row, i) => (
                <rect
                  key={row.bin.from}
                  data-bin={row.bin.from}
                  x={x(row.bin.from)}
                  y={MARGIN.top}
                  width={x(row.bin.to) - x(row.bin.from)}
                  height={PLOT_HEIGHT}
                  fill="transparent"
                  onPointerEnter={() => setHovered(i)}
                  onPointerLeave={() => setHovered((current) => (current === i ? null : current))}
                />
              ))}
            </svg>

            {cuts.map((cut, index) => {
              const label = `Cut between Zone ${zones[index].zone} and Zone ${zones[index + 1].zone}`;
              return (
                <div
                  key={zones[index].zone}
                  role="slider"
                  tabIndex={0}
                  aria-label={label}
                  aria-orientation="horizontal"
                  aria-valuemin={0}
                  aria-valuemax={SCORE_MAX}
                  aria-valuenow={cut}
                  aria-valuetext={`${cut.toFixed(1)} points per match`}
                  className="group absolute w-6 -translate-x-1/2 cursor-ew-resize touch-none outline-none"
                  // Cuts stacked at an end of the scale can only move inward, so the inner one sits on top.
                  style={{
                    left: x(cut),
                    top: MARGIN.top - 12,
                    height: PLOT_HEIGHT + 12,
                    zIndex: 20 - Math.round(Math.abs(cut - SCORE_MAX / 2)),
                  }}
                  onPointerDown={(event) => {
                    event.currentTarget.setPointerCapture(event.pointerId);
                    dragTo(index, event);
                  }}
                  onPointerMove={(event) => {
                    if (event.currentTarget.hasPointerCapture(event.pointerId)) dragTo(index, event);
                  }}
                  onKeyDown={(event) => onHandleKey(index, event)}
                >
                  <div className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-foreground" />
                  <div className="absolute left-1/2 top-0 h-4 w-3 -translate-x-1/2 rounded-sm bg-foreground ring-offset-background group-focus-visible:ring-2 group-focus-visible:ring-ring group-focus-visible:ring-offset-2" />
                </div>
              );
            })}

            {hoveredRow && hoveredRow.parts.length + hoveredRow.bin.ineligible.length > 0 && (
              <div
                role="status"
                className="pointer-events-none absolute z-30 w-40 rounded-md border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md"
                style={{
                  left: Math.min(Math.max(0, x(hoveredRow.bin.from) - 60), Math.max(0, width - 160)),
                  top: MARGIN.top,
                }}
              >
                <p className="font-bold tabular-nums">
                  {hoveredRow.bin.from}–{hoveredRow.bin.to} points
                </p>
                {hoveredRow.parts.map((part) => (
                  <p key={part.zone} className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-sm" style={{ background: zoneColorValue(part.zone) }} />
                      Zone {part.zone}
                    </span>
                    <span className="font-bold tabular-nums">{part.count}</span>
                  </p>
                ))}
                {hoveredRow.bin.ineligible.length > 0 && (
                  <p className="flex items-center justify-between gap-2 text-muted-foreground">
                    <span>Too few putts</span>
                    <span className="font-bold tabular-nums">{hoveredRow.bin.ineligible.length}</span>
                  </p>
                )}
              </div>
            )}
          </>
        )}
      </div>

      <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
        {cuts.map((cut, index) => (
          <CutInput
            key={zones[index].zone}
            id={`zone-cut-${zones[index].zone}`}
            label={`Zone ${zones[index].zone} | Zone ${zones[index + 1].zone}`}
            ariaLabel={`Cut between Zone ${zones[index].zone} and Zone ${zones[index + 1].zone}, points per match`}
            value={cut}
            onCommit={(value) => moveCut(index, value)}
          />
        ))}
        <span className="flex items-center gap-1.5 pb-2 text-xs text-muted-foreground">
          <span className="h-2.5 w-2.5 rounded-sm bg-muted-foreground opacity-35" aria-hidden="true" />
          Too few putts: starts in Zone {defaultZone}
        </span>
      </div>
    </div>
  );
}

/** Commits on blur or Enter, so typing "12" doesn't clamp at "1". */
export function CutInput({
  id,
  label,
  ariaLabel,
  value,
  step = CUT_STEP,
  min = 0,
  max = SCORE_MAX,
  onCommit,
}: {
  id: string;
  label: string;
  ariaLabel?: string;
  value: number;
  step?: number;
  min?: number;
  max?: number;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);

  const commit = () => {
    const parsed = Number(draft);
    if (draft !== null && draft.trim() !== '' && Number.isFinite(parsed)) {
      onCommit(Math.min(max, Math.max(min, parsed)));
    }
    setDraft(null);
  };

  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id} className="text-xs text-muted-foreground">{label}</Label>
      <Input
        id={id}
        aria-label={ariaLabel}
        type="number"
        inputMode="decimal"
        step={step}
        min={min}
        max={max}
        className="h-9 w-24 tabular-nums"
        value={draft ?? value}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit();
        }}
      />
    </div>
  );
}
