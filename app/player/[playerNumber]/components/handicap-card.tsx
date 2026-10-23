'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
    <Card>
      <CardHeader className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Handicap</CardTitle>
            {/* Players are global, zones are per league: always name the league. */}
            <CardDescription>{handicap.league_name}</CardDescription>
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
        <ZoneBadge zone={handicap.current_zone} distanceFt={handicap.distance_ft} size="lg" className="w-fit" />
      </CardHeader>
      <CardContent className="space-y-6">
        <section className="space-y-1">
          <h3 className="text-sm font-semibold">Current period</h3>
          <p className="text-sm">
            {stats.putts_attempted > 0 ? formatPeriodStats(stats) : 'No putts in this zone yet'}
          </p>
          <p className="text-xs text-muted-foreground">In Zone {handicap.current_zone} since {formatTimestampDate(since)}</p>
          {remaining && <p className="text-xs text-muted-foreground">{remaining}</p>}
          <p className="text-xs text-muted-foreground">
            {atTop
              ? `Zone ${handicap.current_zone} is the farthest zone.`
              : `Move up to Zone ${handicap.current_zone + 1}${
                  handicap.next_zone_distance_ft !== null ? ` (${formatDistanceFt(handicap.next_zone_distance_ft)} ft)` : ''
                } above ${handicap.promote_above_pct}%.`}
          </p>
        </section>

        {handicap.career.length > 0 && (
          <section className="space-y-2">
            <h3 className="text-sm font-semibold">Career by distance</h3>
            <table className="w-full text-sm">
              <tbody>
                {handicap.career.map((row) => (
                  <tr key={row.distance_ft} className="border-b last:border-0">
                    <td className="py-1 pr-4 font-medium tabular-nums">{formatDistanceFt(row.distance_ft)} ft</td>
                    <td className="py-1 pr-4 tabular-nums text-muted-foreground">
                      {row.putts_made}/{row.putts_attempted}
                    </td>
                    <td className="py-1 text-right tabular-nums">{formatPct(row.make_pct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        <section className="space-y-2">
          <h3 className="text-sm font-semibold">History</h3>
          <ol className="space-y-2 border-l pl-4">
            {[...handicap.history].reverse().map((period, index, list) => {
              const previous = list[index + 1] ?? null;
              const adminNote = isAdminView(handicap) ? (period as ZonePeriodAdmin).note : null;
              return (
                <li key={`${period.started_at}-${period.zone}`} className="text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{zoneChangeLabel(period.start_reason, period.zone, previous?.zone ?? null)}</span>
                    <span className="text-xs text-muted-foreground">{formatTimestampDate(period.started_at)}</span>
                  </div>
                  {previous?.make_pct != null && (
                    <div className="text-xs text-muted-foreground">
                      After {formatPct(previous.make_pct)} in Zone {previous.zone}
                    </div>
                  )}
                  {adminNote && <div className="text-xs italic text-muted-foreground">Note (admins only): {adminNote}</div>}
                </li>
              );
            })}
          </ol>
        </section>
      </CardContent>
    </Card>
  );
}
