'use client';

import { useEffect, useState } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ZoneBadge, formatDistanceFt } from '@/components/zone-badge';
import { eligibilityText, formatPct, formatPeriodStats, formatTimestampDate, zoneChangeLabel } from '@/lib/utils/handicap-format';
import type { PlayerHandicapAdmin, PlayerHandicapPublic, ZonePeriodAdmin } from '@/lib/types/handicap';

type Handicap = PlayerHandicapPublic | PlayerHandicapAdmin;

function isAdminView(handicap: Handicap): handicap is PlayerHandicapAdmin {
  return 'open_suggestion' in handicap;
}

/**
 * The player's zone in each league that uses handicaps: current zone, the period's
 * stats and progress, career by distance and the history. Renders nothing for a
 * player without a zone anywhere. A pending demotion suggestion is never shown here.
 */
export function HandicapCard({ playerNumber }: { playerNumber: string }) {
  const [leagues, setLeagues] = useState<Handicap[]>([]);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/player/${playerNumber}/handicap`)
      .then((response) => (response.ok ? response.json() : { leagues: [] }))
      .then((data: { leagues: Handicap[] }) => {
        if (cancelled) return;
        setLeagues(data.leagues ?? []);
        setSelected(data.leagues?.[0]?.league_id ?? null);
      })
      .catch(() => {
        if (!cancelled) setLeagues([]);
      });
    return () => {
      cancelled = true;
    };
  }, [playerNumber]);

  const handicap = leagues.find((league) => league.league_id === selected);
  if (!handicap) return null;

  const { stats, progress, since } = handicap.period;
  const remaining = eligibilityText(progress);
  const atTop = handicap.current_zone >= handicap.max_zone;

  return (
    <section aria-labelledby="handicap-heading" className="flex flex-col gap-4 rounded-2xl border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="handicap-heading" className="text-lg font-bold">Handicap</h2>
          {/* Players are global, zones are per league: always name the league. */}
          <p className="text-[13px] text-muted-foreground">{handicap.league_name}</p>
        </div>
        {leagues.length > 1 && (
          <Select value={selected ?? undefined} onValueChange={setSelected}>
            <SelectTrigger className="w-[200px]" aria-label="League">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {leagues.map((league) => (
                <SelectItem key={league.league_id} value={league.league_id}>
                  {league.league_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      <div className="flex items-end justify-between gap-3">
        <div className="flex flex-col">
          <span className="font-score text-5xl leading-none font-bold tabular-nums">
            {stats.putts_attempted > 0 ? formatPct(stats.make_pct) : '–'}
          </span>
          <span className="text-[13px] text-muted-foreground">
            {stats.putts_attempted > 0 ? formatPeriodStats(stats) : 'No putts in this zone yet'}
          </span>
        </div>
        <ZoneBadge zone={handicap.current_zone} distanceFt={handicap.distance_ft} className="shrink-0" />
      </div>
      {stats.make_pct !== null && stats.putts_attempted > 0 && (
        <div role="img" aria-label={`${formatPct(stats.make_pct)} made this period`} className="h-2 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-foreground" style={{ width: `${Math.min(100, stats.make_pct)}%` }} />
        </div>
      )}
      <div className="flex flex-col gap-0.5 text-xs text-muted-foreground">
        <span>In Zone {handicap.current_zone} since {formatTimestampDate(since)}</span>
        {remaining && <span>{remaining}</span>}
        <span>
          {atTop
            ? `Zone ${handicap.current_zone} is the farthest zone.`
            : `Move up to Zone ${handicap.current_zone + 1}${
                handicap.next_zone_distance_ft !== null ? ` (${formatDistanceFt(handicap.next_zone_distance_ft)} ft)` : ''
              } above ${handicap.promote_above_pct}%.`}
        </span>
      </div>

      {handicap.career.length > 0 && (
        <section className="flex flex-col gap-2 border-t border-muted pt-3">
          <h3 className="text-sm font-bold">Career by distance</h3>
          {handicap.career.map((row) => (
            <div key={row.distance_ft} className="grid grid-cols-[52px_minmax(0,1fr)_auto] items-center gap-3 py-0.5">
              <span className="text-sm font-semibold tabular-nums">{formatDistanceFt(row.distance_ft)} ft</span>
              <div className="h-2.5 overflow-hidden rounded-full bg-muted" title={`${row.putts_made}/${row.putts_attempted}`}>
                <div className="h-full rounded-full bg-foreground" style={{ width: `${Math.min(100, row.make_pct ?? 0)}%` }} />
              </div>
              <span className="text-right">
                <span className="font-score text-[22px] font-bold tabular-nums">{formatPct(row.make_pct)}</span>
                <span className="ml-1.5 text-xs text-muted-foreground tabular-nums">
                  {row.putts_made}/{row.putts_attempted}
                </span>
              </span>
            </div>
          ))}
        </section>
      )}

      <section className="flex flex-col gap-2 border-t border-muted pt-3">
        <h3 className="text-sm font-bold">History</h3>
        <ol className="flex flex-col gap-2">
          {[...handicap.history].reverse().map((period, index, list) => {
            const previous = list[index + 1] ?? null;
            const adminNote = isAdminView(handicap) ? (period as ZonePeriodAdmin).note : null;
            return (
              <li key={`${period.started_at}-${period.zone}`} className="flex gap-2.5 text-sm">
                <span className="w-24 shrink-0 text-muted-foreground">{formatTimestampDate(period.started_at)}</span>
                <span className="flex flex-col">
                  <span className="font-medium">{zoneChangeLabel(period.start_reason, period.zone, previous?.zone ?? null)}</span>
                  {previous?.make_pct != null && (
                    <span className="text-xs text-muted-foreground">
                      After {formatPct(previous.make_pct)} in Zone {previous.zone}
                    </span>
                  )}
                  {adminNote && <span className="text-xs italic text-muted-foreground">Note (admins only): {adminNote}</span>}
                </span>
              </li>
            );
          })}
        </ol>
      </section>
    </section>
  );
}
