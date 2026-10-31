'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Ban, Loader2, Lock, Pencil, Ruler } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import { ZoneBadge, formatDistanceFt, zoneColorClass } from '@/components/zone-badge';
import { cn } from '@/lib/utils/utils';
import { formatPct } from '@/lib/utils/handicap-format';
import { eventZoneDistancesError, zoneDistanceWarnings } from '@/lib/services/handicap/validation';
import {
  ZONE_DISTANCE_WARN_FT,
  type EvaluationSummary,
  type EvaluationSummaryEntry,
  type EventZoneDistances,
} from '@/lib/types/handicap';
import type { EventWithDetails } from '@/lib/types/event';
import type { EventPlayer } from '@/lib/types/player';

type EventHandicapView = EventZoneDistances & { summary: EvaluationSummary | null };

interface EventHandicapContextValue {
  event: EventWithDetails;
  view: EventHandicapView | null;
  setView: (view: EventHandicapView) => void;
  /** Re-fetch the event after a write changed its entries. */
  onEntriesChanged: () => void;
}

const EventHandicapContext = createContext<EventHandicapContextValue | null>(null);

/** Null outside an admin view of a handicap event; callers then render read-only badges. */
export function useEventHandicap(): EventHandicapContextValue | null {
  return useContext(EventHandicapContext);
}

async function sendJson(url: string, method: 'PUT' | 'PATCH', body: unknown): Promise<unknown> {
  const response = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || 'Request failed');
  return data;
}

function isBeforeBracket(event: EventWithDetails): boolean {
  return event.status === 'created' || event.status === 'pre-bracket';
}

/**
 * Loads an event's handicap setup once for the header, the roster and every entry
 * popover. Render it only for event admins of a handicap event.
 */
export function EventHandicapProvider({
  event,
  onEntriesChanged,
  children,
}: {
  event: EventWithDetails;
  onEntriesChanged: () => void;
  children: React.ReactNode;
}) {
  const [view, setView] = useState<EventHandicapView | null>(null);

  const load = useCallback(async () => {
    const response = await fetch(`/api/event/${event.id}/handicap`);
    if (!response.ok) return;
    setView(await response.json());
  }, [event.id]);

  useEffect(() => {
    load();
  }, [load, event.status]);

  return (
    <EventHandicapContext.Provider value={{ event, view, setView, onEntriesChanged }}>
      {children}
    </EventHandicapContext.Provider>
  );
}

/** Tonight's distances, editable until the event's first recorded frame. */
function ZoneDistancesForm({ onDone }: { onDone: () => void }) {
  const handicap = useEventHandicap();
  const view = handicap?.view;
  const [distances, setDistances] = useState<Record<number, string>>(() =>
    Object.fromEntries((view?.zones ?? []).map((zone) => [zone.zone, String(zone.distance_ft)]))
  );
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  if (!handicap || !view) return null;

  const edited = view.zones.map((zone) => ({ zone: zone.zone, distance_ft: Number(distances[zone.zone]) }));
  const league = view.zones.flatMap((zone) =>
    zone.league_distance_ft !== null ? [{ zone: zone.zone, distance_ft: zone.league_distance_ft }] : []
  );
  const error = eventZoneDistancesError(edited, league);
  const warnings = new Set(zoneDistanceWarnings(edited, league));
  const changed = view.zones.some((zone) => Number(distances[zone.zone]) !== zone.distance_ft);

  const save = async () => {
    setSaving(true);
    try {
      const data = (await sendJson(`/api/event/${handicap.event.id}/handicap`, 'PUT', { zones: edited })) as EventHandicapView;
      handicap.setView(data);
      toast({ title: 'Saved', description: "Tonight's zone distances updated" });
      handicap.onEntriesChanged();
      onDone();
    } catch (saveError) {
      toast({
        title: 'Error',
        description: saveError instanceof Error ? saveError.message : 'Failed to save distances',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[15px] font-bold">Zone distances tonight</h3>
        {!view.editable && (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Lock className="size-3" aria-hidden="true" />
            Fixed
          </span>
        )}
      </div>
      {view.zones.map((zone) => (
        <div key={zone.zone} className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <ZoneBadge zone={zone.zone} distanceFt={null} className="w-[4.5rem] justify-center" />
            <Input
              type="number"
              inputMode="decimal"
              step="0.5"
              className="h-9 w-20 tabular-nums"
              aria-label={`Zone ${zone.zone} distance tonight`}
              disabled={!view.editable}
              value={distances[zone.zone] ?? ''}
              onChange={(e) => setDistances((current) => ({ ...current, [zone.zone]: e.target.value }))}
            />
            <span className="text-sm text-muted-foreground">
              ft
              {zone.league_distance_ft !== null && ` · league ${formatDistanceFt(zone.league_distance_ft)}`}
            </span>
          </div>
          {warnings.has(zone.zone) && (
            <span className="flex items-center gap-1 text-xs text-warning">
              <AlertTriangle className="size-3" aria-hidden="true" />
              More than {ZONE_DISTANCE_WARN_FT} ft from the league default
            </span>
          )}
        </div>
      ))}
      <p className="text-xs text-muted-foreground">
        {view.editable
          ? 'Applies to everyone without a hand-set distance. Fixed once the first frame is recorded.'
          : 'Fixed: frames have been recorded for this event.'}
      </p>
      {view.editable && error && <p className="text-sm text-destructive">{error}</p>}
      {view.editable && (
        <Button size="sm" className="self-start" onClick={save} disabled={saving || !changed || error !== null}>
          {saving && <Loader2 className="mr-2 size-4 animate-spin" />}
          Save distances
        </Button>
      )}
    </div>
  );
}

/** Opens tonight's distances from any trigger (the header tile, the roster's ladder chip). */
export function ZoneDistancesPopover({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="start" className="w-80">
        <ZoneDistancesForm onDone={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  );
}

/** "Tonight Z1 21 · Z2 27 · Z3 33" chip above the roster; null until the setup loads. */
export function ZoneLadderChip({ className }: { className?: string }) {
  const handicap = useEventHandicap();
  const view = handicap?.view;
  if (!view || view.zones.length === 0) return null;
  return (
    <ZoneDistancesPopover>
      <button
        type="button"
        className={cn(
          'inline-flex h-10 items-center gap-1 rounded-lg border-[1.5px] border-input bg-control pr-2 pl-2.5 text-xs hover:border-foreground/40',
          className
        )}
        aria-label={`Tonight's zone distances: ${view.zones.map((zone) => `Zone ${zone.zone} ${formatDistanceFt(zone.distance_ft)} feet`).join(', ')}`}
      >
        <span className="mr-0.5 font-semibold text-muted-foreground">Tonight</span>
        {view.zones.map((zone) => (
          <span
            key={zone.zone}
            className={cn('rounded-md border px-1.5 py-0.5 font-bold tabular-nums', zoneColorClass(zone.zone))}
          >
            Z{zone.zone} {formatDistanceFt(zone.distance_ft)}
          </span>
        ))}
        {view.editable ? (
          <Pencil className="ml-1 size-3.5 text-muted-foreground" aria-hidden="true" />
        ) : (
          <Lock className="ml-1 size-3.5 text-muted-foreground" aria-hidden="true" />
        )}
      </button>
    </ZoneDistancesPopover>
  );
}

/** "21 / 27 / 33" for the header's Putt Distance tile; null until the setup loads. */
export function zoneLadderText(view: EventHandicapView | null | undefined): string | null {
  if (!view || view.zones.length === 0) return null;
  return view.zones.map((zone) => formatDistanceFt(zone.distance_ft)).join(' / ');
}

/** One entry's distance tonight and "don't count". The zone itself is a league setting. */
function EntryHandicapForm({ entry }: { entry: EventPlayer }) {
  const handicap = useEventHandicap()!;
  const { event, view, onEntriesChanged } = handicap;
  const [distance, setDistance] = useState(entry.putt_distance_ft !== undefined ? String(entry.putt_distance_ft) : '');
  const [note, setNote] = useState(entry.handicap_note ?? '');
  const [busy, setBusy] = useState<'distance' | 'exclude' | 'note' | null>(null);
  const { toast } = useToast();
  const name = entry.player.full_name;
  const excluded = entry.exclude_from_handicap ?? false;
  const zoneDistance = view?.zones.find((zone) => zone.zone === entry.zone)?.distance_ft;
  const distanceEditable = isBeforeBracket(event);

  const patch = async (kind: 'distance' | 'exclude' | 'note', body: Record<string, unknown>) => {
    setBusy(kind);
    try {
      await sendJson(`/api/event/${event.id}/entries/${entry.id}/handicap`, 'PATCH', body);
      onEntriesChanged();
    } catch (patchError) {
      toast({
        title: 'Error',
        description: patchError instanceof Error ? patchError.message : 'Failed to update entry',
        variant: 'destructive',
      });
    } finally {
      setBusy(null);
    }
  };

  const distanceValue = Number(distance);
  const distanceChanged = distance !== '' && distanceValue > 0 && distanceValue !== entry.putt_distance_ft;

  return (
    <div className="flex flex-col gap-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <h3 className="truncate text-[15px] font-bold">{name}</h3>
        <ZoneBadge zone={entry.zone} distanceFt={null} size="sm" />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={`distance-${entry.id}`} className="font-semibold">Distance tonight</label>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            id={`distance-${entry.id}`}
            type="number"
            inputMode="decimal"
            step="0.5"
            className="h-9 w-20 tabular-nums"
            disabled={!distanceEditable || busy !== null}
            value={distance}
            onChange={(e) => setDistance(e.target.value)}
          />
          <span className="text-muted-foreground">ft</span>
          {distanceEditable && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy !== null || !distanceChanged}
              onClick={() => patch('distance', { putt_distance_ft: distanceValue })}
            >
              {busy === 'distance' && <Loader2 className="mr-1 size-3.5 animate-spin" />}
              Set
            </Button>
          )}
          {distanceEditable && entry.distance_override && (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy !== null}
              onClick={() => patch('distance', { putt_distance_ft: null })}
            >
              Reset{zoneDistance !== undefined && ` to ${formatDistanceFt(zoneDistance)}`}
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          {!distanceEditable
            ? `Fixed for this event${entry.distance_override ? ' (set by hand)' : ''}.`
            : entry.distance_override
              ? 'Set by hand for this player.'
              : zoneDistance !== undefined
                ? `Zone ${entry.zone} measures ${formatDistanceFt(zoneDistance)} ft tonight.`
                : 'Fixed once this player records a frame.'}
        </p>
      </div>

      <div className="h-px bg-border" />

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <label htmlFor={`exclude-${entry.id}`} className="font-semibold">Don&apos;t count this night</label>
          <Switch
            id={`exclude-${entry.id}`}
            checked={excluded}
            disabled={busy !== null}
            onCheckedChange={(checked) =>
              patch('exclude', checked ? { exclude_from_handicap: true } : { exclude_from_handicap: false, note: null })
            }
            className="data-[state=checked]:bg-success"
          />
        </div>
        {excluded ? (
          <>
            <Textarea
              aria-label={`Note about ${name}'s night, for organizers`}
              placeholder="Note for organizers (optional)"
              className="min-h-16 text-sm md:text-sm"
              maxLength={1000}
              value={note}
              disabled={busy !== null}
              onChange={(e) => setNote(e.target.value)}
            />
            <Button
              size="sm"
              variant="outline"
              className="self-start"
              disabled={busy !== null || note.trim() === (entry.handicap_note ?? '')}
              onClick={() => patch('note', { note: note.trim() || null })}
            >
              {busy === 'note' && <Loader2 className="mr-1 size-3.5 animate-spin" />}
              Save note
            </Button>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">
            Leaves tonight out of their zone decision, for example an injury accommodation. It still shows in
            their career stats.
          </p>
        )}
      </div>

      <div className="h-px bg-border" />

      <Link href={`/admin/leagues/${event.league_id}`} className="text-[13px] text-info hover:underline">
        Change their zone in the league&apos;s Handicaps tab
      </Link>
    </div>
  );
}

/**
 * An entry's zone badge, with markers for a hand-set distance and "don't count". For
 * event admins it opens the entry's handicap controls.
 */
export function EntryZoneCell({ entry, compact = false }: { entry: EventPlayer; compact?: boolean }) {
  const handicap = useEventHandicap();
  if (entry.zone === null || entry.zone === undefined) {
    return handicap ? <span className="text-xs text-muted-foreground">No zone</span> : null;
  }

  const badge = <ZoneBadge zone={entry.zone} distanceFt={entry.putt_distance_ft} size="sm" />;
  const markers = (
    <>
      {entry.distance_override && (
        compact ? (
          <Ruler className="size-3.5 shrink-0 text-info" aria-label="Distance set by hand" />
        ) : (
          <span className="text-[11px] font-semibold whitespace-nowrap text-info">Set by hand</span>
        )
      )}
      {entry.exclude_from_handicap && (
        compact ? (
          <Ban className="size-3.5 shrink-0 text-warning" aria-label="Not counted toward handicap" />
        ) : (
          <span className="text-[11px] font-semibold whitespace-nowrap text-warning">Not counted</span>
        )
      )}
    </>
  );

  if (!handicap) {
    return <span className="inline-flex items-center gap-1.5">{badge}{markers}</span>;
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="-mx-1 inline-flex shrink-0 items-center gap-1.5 rounded-md px-1 py-0.5 hover:bg-muted"
          aria-label={`Handicap for ${entry.player.full_name}: Zone ${entry.zone}, ${entry.putt_distance_ft ?? '?'} feet${entry.distance_override ? ', set by hand' : ''}${entry.exclude_from_handicap ? ', not counted' : ''}`}
        >
          {badge}
          {markers}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80">
        <EntryHandicapForm key={`${entry.putt_distance_ft}|${entry.handicap_note ?? ''}`} entry={entry} />
      </PopoverContent>
    </Popover>
  );
}

/** What completing the event did to handicaps, once it is completed. */
export function EventHandicapSummary() {
  const handicap = useEventHandicap();
  const summary = handicap?.view?.summary;
  if (!handicap || !summary) return null;
  return <EvaluationSummaryCard summary={summary} leagueId={handicap.event.league_id} />;
}

function SummaryList({ title, entries, render }: {
  title: string;
  entries: EvaluationSummaryEntry[];
  render: (entry: EvaluationSummaryEntry) => string;
}) {
  if (entries.length === 0) return null;
  return (
    <div className="space-y-1">
      <h4 className="text-sm font-semibold">{title}</h4>
      <ul className="space-y-0.5 text-sm">
        {entries.map((entry) => (
          <li key={entry.player_id}>
            <span className="font-medium">{entry.player_name}</span> — {render(entry)}
          </li>
        ))}
      </ul>
    </div>
  );
}

const SKIP_LABELS: Record<string, string> = {
  period_changed: 'zone changed since this event started',
  excluded: "marked don't count",
};

export function EvaluationSummaryCard({ summary, leagueId }: { summary: EvaluationSummary; leagueId: string }) {
  const parts = [
    summary.moved_up.length > 0 && `${summary.moved_up.length} moved up`,
    summary.moved_down.length > 0 && `${summary.moved_down.length} moved closer`,
    summary.flagged.length > 0 && `${summary.flagged.length} flagged for review`,
    `${summary.unchanged} unchanged`,
    summary.skipped.length > 0 && `${summary.skipped.length} not evaluated`,
  ].filter(Boolean);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Handicap results</CardTitle>
        <CardDescription>{parts.join(' · ')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <SummaryList
          title="Moved up"
          entries={summary.moved_up}
          render={(entry) => `Zone ${entry.zone} → ${entry.new_zone ?? entry.zone + 1} (${formatPct(entry.make_pct)} over ${entry.putts_attempted} putts)`}
        />
        <SummaryList
          title="Moved closer"
          entries={summary.moved_down}
          render={(entry) => `Zone ${entry.zone} → ${entry.new_zone ?? entry.zone - 1} (${formatPct(entry.make_pct)} over ${entry.putts_attempted} putts)`}
        />
        <SummaryList
          title="Flagged for review"
          entries={summary.flagged}
          render={(entry) => `${formatPct(entry.make_pct)} over ${entry.putts_attempted} putts in Zone ${entry.zone}`}
        />
        {summary.flagged.length > 0 && (
          <Link href={`/admin/leagues/${leagueId}`} className="text-sm text-primary hover:underline">
            Review in the league&apos;s Handicaps tab
          </Link>
        )}
        <SummaryList
          title="Not evaluated"
          entries={summary.skipped}
          render={(entry) => SKIP_LABELS[entry.skip_reason ?? ''] ?? 'skipped'}
        />
      </CardContent>
    </Card>
  );
}
