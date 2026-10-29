'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/components/ui/use-toast';
import { ZoneBadge, formatDistanceFt } from '@/components/zone-badge';
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

/**
 * Event admin controls for a handicap event: tonight's zone distances (until the first
 * frame), each entry's zone, distance override and "don't count" toggle, and after
 * completion the evaluation summary.
 */
export function EventHandicapPanel({
  event,
  onPlayersChanged,
}: {
  event: EventWithDetails;
  onPlayersChanged: () => void;
}) {
  const [view, setView] = useState<EventHandicapView | null>(null);
  const [distances, setDistances] = useState<Record<number, string>>({});
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  const load = useCallback(async () => {
    const response = await fetch(`/api/event/${event.id}/handicap`);
    if (!response.ok) return;
    const data: EventHandicapView = await response.json();
    setView(data);
    setDistances(Object.fromEntries(data.zones.map((zone) => [zone.zone, String(zone.distance_ft)])));
  }, [event.id]);

  useEffect(() => {
    load();
  }, [load, event.status]);

  if (!event.handicap_enabled || !view) return null;

  const edited = view.zones.map((zone) => ({ zone: zone.zone, distance_ft: Number(distances[zone.zone]) }));
  const league = view.zones.flatMap((zone) =>
    zone.league_distance_ft !== null ? [{ zone: zone.zone, distance_ft: zone.league_distance_ft }] : []
  );
  const error = eventZoneDistancesError(edited, league);
  const warnings = new Set(zoneDistanceWarnings(edited, league));
  const changed = view.zones.some((zone) => Number(distances[zone.zone]) !== zone.distance_ft);

  const saveDistances = async () => {
    setSaving(true);
    try {
      const data = (await sendJson(`/api/event/${event.id}/handicap`, 'PUT', { zones: edited })) as EventHandicapView;
      setView(data);
      toast({ title: 'Saved', description: "Tonight's zone distances updated" });
      onPlayersChanged();
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
    <div className="space-y-6">
      {view.summary && <EvaluationSummaryCard summary={view.summary} leagueId={event.league_id} />}

      <Card>
        <CardHeader>
          <CardTitle>Zone distances tonight</CardTitle>
          <CardDescription>
            {view.editable
              ? 'Set what each zone measures at this venue. Fixed once the first frame is recorded.'
              : 'Fixed: frames have been recorded for this event.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {view.zones.map((zone) => (
            <div key={zone.zone} className="flex flex-wrap items-center gap-3">
              <ZoneBadge zone={zone.zone} distanceFt={null} className="w-20 justify-center" />
              <Input
                type="number"
                inputMode="decimal"
                step="0.5"
                className="w-28"
                aria-label={`Zone ${zone.zone} distance tonight`}
                disabled={!view.editable}
                value={distances[zone.zone] ?? ''}
                onChange={(e) => setDistances((current) => ({ ...current, [zone.zone]: e.target.value }))}
              />
              <span className="text-sm text-muted-foreground">
                ft
                {zone.league_distance_ft !== null && ` · league default ${formatDistanceFt(zone.league_distance_ft)} ft`}
              </span>
              {warnings.has(zone.zone) && (
                <span className="flex items-center gap-1 text-xs text-warning">
                  <AlertTriangle className="h-3 w-3" />
                  More than {ZONE_DISTANCE_WARN_FT} ft from the league default
                </span>
              )}
            </div>
          ))}
          {view.editable && error && <p className="text-sm text-destructive">{error}</p>}
          {view.editable && (
            <Button onClick={saveDistances} disabled={saving || !changed || error !== null}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save distances
            </Button>
          )}
        </CardContent>
      </Card>

      <EntryHandicapTable event={event} onChanged={onPlayersChanged} />
    </div>
  );
}

function EntryHandicapTable({ event, onChanged }: { event: EventWithDetails; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const { toast } = useToast();
  const beforeBracket = event.status === 'created' || event.status === 'pre-bracket';

  const patch = async (entry: EventPlayer, body: Record<string, unknown>) => {
    setBusy(entry.id);
    try {
      await sendJson(`/api/event/${event.id}/entries/${entry.id}/handicap`, 'PATCH', body);
      onChanged();
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

  const players = [...event.players].sort((a, b) => a.player.full_name.localeCompare(b.player.full_name));
  if (players.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Player zones</CardTitle>
        <CardDescription>
          Each entry keeps the zone and distance it was set up with. &quot;Don&apos;t count&quot; keeps a night that
          isn&apos;t representative (an injury accommodation) out of the player&apos;s handicap; it still shows in
          their career stats.
        </CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Player</TableHead>
              <TableHead>Zone</TableHead>
              {beforeBracket && <TableHead>Distance override</TableHead>}
              <TableHead>Don&apos;t count</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {players.map((entry) => (
              <TableRow key={entry.id}>
                <TableCell className="font-medium">{entry.player.full_name}</TableCell>
                <TableCell>
                  <ZoneBadge zone={entry.zone} distanceFt={entry.putt_distance_ft} size="sm" />
                  {entry.distance_override && <span className="ml-1 text-xs text-muted-foreground">(set by hand)</span>}
                </TableCell>
                {beforeBracket && (
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        inputMode="decimal"
                        step="0.5"
                        className="h-8 w-20"
                        aria-label={`Distance for ${entry.player.full_name}`}
                        placeholder={entry.putt_distance_ft !== undefined ? formatDistanceFt(entry.putt_distance_ft) : ''}
                        value={overrides[entry.id] ?? ''}
                        onChange={(e) => setOverrides((current) => ({ ...current, [entry.id]: e.target.value }))}
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy !== null || !(Number(overrides[entry.id]) > 0)}
                        onClick={() => patch(entry, { putt_distance_ft: Number(overrides[entry.id]) })}
                      >
                        Set
                      </Button>
                      {entry.distance_override && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy !== null}
                          onClick={() => patch(entry, { putt_distance_ft: null })}
                        >
                          Reset
                        </Button>
                      )}
                    </div>
                  </TableCell>
                )}
                <TableCell>
                  <Switch
                    checked={entry.exclude_from_handicap ?? false}
                    disabled={busy !== null}
                    aria-label={`Don't count this event toward ${entry.player.full_name}'s handicap`}
                    onCheckedChange={(checked) => {
                      const note = checked ? window.prompt('Note for organizers (optional)') : null;
                      patch(entry, { exclude_from_handicap: checked, note: checked ? note : null });
                    }}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
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

/** What completing the event did to handicaps. */
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
