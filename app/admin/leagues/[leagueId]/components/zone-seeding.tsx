'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { ZoneBadge } from '@/components/zone-badge';
import { cn } from '@/lib/utils/utils';
import type { ZoneSeedData, ZoneSeedResult } from '@/lib/types/handicap';
import { assignStartingZones, defaultCuts, expectedScore, SCORE_MAX, zoneForScore } from '@/lib/utils/zone-cuts';
import { postJson } from './post-json';
import { CutInput, ZoneCutHistogram } from './zone-cut-histogram';
import { ZoneSeedReview, type ReviewRow } from './zone-seed-review';

const DEFAULT_ZONE_EFFECT = 3;

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** Set a new league's starting zones with cut lines on another league's past scoring. */
export function ZoneSeeding({ leagueId, onChanged }: { leagueId: string; onChanged: () => void }) {
  const [data, setData] = useState<ZoneSeedData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [pickedSource, setPickedSource] = useState<string | undefined>(undefined);
  const [zoneEffect, setZoneEffect] = useState(DEFAULT_ZONE_EFFECT);
  // Null until dragged: the cuts follow the field and the zone effect until then.
  const [draggedCuts, setDraggedCuts] = useState<number[] | null>(null);
  const [overrides, setOverrides] = useState<Record<string, number>>({});
  const [reviewOpen, setReviewOpen] = useState(false);
  const [applying, setApplying] = useState(false);
  const { toast } = useToast();

  const load = useCallback(async (sourceId?: string) => {
    try {
      const query = sourceId ? `?source_league_id=${sourceId}` : '';
      const response = await fetch(`/api/league/${leagueId}/handicap/seed${query}`);
      if (!response.ok) throw new Error('Failed to load past scoring');
      setData(await response.json());
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load past scoring');
    }
  }, [leagueId]);

  useEffect(() => {
    load();
  }, [load]);

  const cuts = useMemo(
    () => draggedCuts ?? (data ? defaultCuts(data.candidates, data.zones, data.default_zone, zoneEffect) : []),
    [draggedCuts, data, zoneEffect]
  );

  const rows = useMemo<ReviewRow[]>(() => {
    if (!data) return [];
    const assigned = assignStartingZones(data.candidates, cuts, data.zones, data.default_zone, overrides);
    return data.candidates.map((candidate, i) => ({
      candidate,
      fromCuts: candidate.eligible
        ? zoneForScore(candidate.history.points_per_match, cuts, data.zones, data.default_zone)
        : data.default_zone,
      zone: assigned[i].zone,
      overridden: assigned[i].source === 'override',
      changed: assigned[i].zone !== (candidate.current_zone ?? data.default_zone),
    }));
  }, [data, cuts, overrides]);

  const tiles = useMemo(() => {
    if (!data) return [];
    return data.zones.map((definition) => {
      const inZone = rows.filter((row) => row.zone === definition.zone);
      const thin = inZone.filter((row) => !row.candidate.eligible && !row.overridden);
      const scored = inZone.filter((row) => row.candidate.eligible || row.overridden);
      const expected = scored.length === 0 ? null : scored.reduce(
        (sum, row) => sum + expectedScore(row.candidate.history.points_per_match, data.default_zone, definition.zone, zoneEffect),
        0
      ) / scored.length;
      return { definition, count: scored.length, thin: thin.length, expected };
    });
  }, [data, rows, zoneEffect]);

  if (error && !data) return <p className="text-sm text-destructive">{error}</p>;
  if (!data?.source || (data.candidates.length === 0 && pickedSource === undefined)) return null;

  const { source, zones, sources, settings, candidates, locked_count: lockedCount, default_zone: defaultZone } = data;
  const changes = rows.filter((row) => row.changed);
  const hasEligible = candidates.some((candidate) => candidate.eligible);

  const changeSource = (sourceId: string) => {
    setPickedSource(sourceId);
    setOverrides({});
    setDraggedCuts(null);
    load(sourceId);
  };

  const pick = (playerId: string, zone: number) => {
    const row = rows.find((candidateRow) => candidateRow.candidate.player_id === playerId);
    setOverrides((current) => {
      const next = { ...current };
      if (row?.fromCuts === zone) delete next[playerId];
      else next[playerId] = zone;
      return next;
    });
  };

  const apply = async () => {
    setApplying(true);
    try {
      const activeCuts = cuts.filter((cut) => cut > 0 && cut < SCORE_MAX).map((cut) => cut.toFixed(1)).join(' / ');
      const result = await postJson<ZoneSeedResult>(`/api/league/${leagueId}/handicap/seed`, {
        assignments: changes.map((row) => ({ player_id: row.candidate.player_id, zone: row.zone })),
        note: `Starting zone from ${source.league_name}, cuts ${activeCuts} points per match`,
      });
      toast({
        title: 'Starting zones applied',
        description: result.skipped.length > 0
          ? `${plural(result.applied, 'player')} set, ${result.skipped.length} skipped: already putted or moved`
          : `${plural(result.applied, 'player')} set`,
      });
      await load(pickedSource);
      onChanged();
    } catch (applyError) {
      toast({
        title: 'Error',
        description: applyError instanceof Error ? applyError.message : 'Failed to set starting zones',
        variant: 'destructive',
      });
    } finally {
      setApplying(false);
    }
  };

  return (
    <section aria-labelledby="zone-seeding-heading" className="rounded-2xl border bg-card">
      <h2 id="zone-seeding-heading">
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
          className="flex w-full items-center justify-between gap-3 rounded-2xl px-5 py-4 text-left text-lg font-bold"
        >
          Set starting zones from past putting
          <ChevronDown className={cn('h-5 w-5 shrink-0 text-muted-foreground transition-transform', expanded && 'rotate-180')} />
        </button>
      </h2>

      {expanded && (
        <div className="flex flex-col gap-5 border-t px-5 py-4">
          <div className="flex flex-col gap-1 text-sm text-muted-foreground">
            <p>
              Drag the cut lines between zones, check the counts, then apply. Applies to future events, plus tonight&apos;s
              entries until a player&apos;s first putt. Players with no past putts still start in Zone {defaultZone}.
            </p>
            <p>
              Scores come from match points, and a small sample is only a rough guide. Cut lines are not saved and
              don&apos;t change the league thresholds.
            </p>
          </div>

          <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted-foreground">Based on:</span>
              {sources.length > 1 ? (
                <Select value={source.league_id} onValueChange={changeSource}>
                  <SelectTrigger className="h-9 w-auto max-w-64 font-semibold" aria-label="Source league">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {sources.map((option) => (
                      <SelectItem key={option.league_id} value={option.league_id}>{option.league_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <span className="font-semibold">{source.league_name}</span>
              )}
              <span className="text-muted-foreground">· {plural(source.events, 'event')}</span>
            </div>
            <CutInput
              id="zone-effect"
              label="Points gained or lost per zone"
              value={zoneEffect}
              step={0.5}
              min={0.5}
              max={10}
              onCommit={setZoneEffect}
            />
            {draggedCuts && (
              <Button size="sm" variant="ghost" onClick={() => setDraggedCuts(null)}>Reset cuts</Button>
            )}
          </div>
          <p className="-mt-3 text-xs text-muted-foreground">
            The points per zone is an assumption: no putts have been taken from another zone yet.
          </p>

          {hasEligible ? (
            <ZoneCutHistogram
              candidates={candidates}
              cuts={cuts}
              zones={zones}
              defaultZone={defaultZone}
              onCutsChange={setDraggedCuts}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              No player in this league&apos;s history has enough putts yet
              {settings.min_putts > 0 && ` (${settings.min_putts} putts needed)`}.
            </p>
          )}

          <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-3">
            {tiles.map(({ definition, count, thin, expected }) => {
              const verb = definition.zone < defaultZone ? 'start closer' : definition.zone > defaultZone ? 'start farther' : 'stay';
              return (
                <div key={definition.zone} className="flex flex-col gap-1.5 rounded-xl border px-4 py-3" data-testid={`zone-tile-${definition.zone}`}>
                  <ZoneBadge zone={definition.zone} distanceFt={definition.distance_ft} size="sm" className="self-start" />
                  <p className="text-sm">
                    <span className="font-score text-2xl leading-none font-bold tabular-nums">{count}</span> {verb}
                    {thin > 0 && <span className="text-muted-foreground"> · {thin} too few putts</span>}
                  </p>
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {expected === null ? 'Nobody here' : `About ${expected.toFixed(1)} per match`}
                  </p>
                </div>
              );
            })}
          </div>

          {lockedCount > 0 && (
            <p className="text-sm text-muted-foreground">
              {plural(lockedCount, 'player')} already putted or moved in this league; use Change zone.
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setReviewOpen(true)} disabled={rows.length === 0}>
              Review {plural(rows.length, 'player')}
            </Button>
            <Button onClick={apply} disabled={applying || changes.length === 0}>
              {applying && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Apply {plural(changes.length, 'starting zone')}
            </Button>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
      )}

      <ZoneSeedReview
        open={reviewOpen}
        onOpenChange={setReviewOpen}
        rows={rows}
        zones={zones}
        onPick={pick}
        onResetOverrides={() => setOverrides({})}
      />
    </section>
  );
}
