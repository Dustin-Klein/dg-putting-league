import { cn } from '@/lib/utils/utils';

/**
 * One color per zone, the same everywhere in the app, so a scorer holding a phone at
 * arm's length can tell zones apart. The text is always there too (colour is never the
 * only signal).
 */
const ZONE_COLORS: Record<number, string> = {
  1: 'bg-zone-1 text-zone-1-foreground border-zone-1',
  2: 'bg-zone-2 text-zone-2-foreground border-zone-2',
  3: 'bg-zone-3 text-zone-3-foreground border-zone-3',
  4: 'bg-zone-4 text-zone-4-foreground border-zone-4',
};

export function zoneColorClass(zone: number): string {
  return ZONE_COLORS[zone] ?? 'bg-muted-foreground text-background border-muted-foreground';
}

export function formatDistanceFt(distance: number): string {
  return Number.isInteger(distance) ? String(distance) : distance.toFixed(1).replace(/\.0$/, '');
}

/**
 * "ZONE 3 · 33 FT", under a player's name on scoring and match views. Renders nothing
 * for an event without handicaps (no zone).
 */
export function ZoneBadge({
  zone,
  distanceFt,
  size = 'md',
  className,
}: {
  zone: number | null | undefined;
  distanceFt: number | null | undefined;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  if (zone === null || zone === undefined) return null;
  return (
    <span
      className={cn(
        'inline-flex items-center whitespace-nowrap rounded-md border font-bold uppercase tracking-wide tabular-nums',
        size === 'sm' && 'px-1.5 py-0 text-[10px]',
        size === 'md' && 'px-2 py-0.5 text-xs',
        size === 'lg' && 'px-2.5 py-1 text-sm',
        zoneColorClass(zone),
        className
      )}
      aria-label={`Zone ${zone}, ${distanceFt != null ? formatDistanceFt(distanceFt) : '?'} feet`}
    >
      Zone {zone}
      {distanceFt != null && <> · {formatDistanceFt(distanceFt)} ft</>}
    </span>
  );
}
