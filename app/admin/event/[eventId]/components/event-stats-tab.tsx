'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Download, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/status-badge';
import { ZoneBadge } from '@/components/zone-badge';
import { SeasonScatter } from '@/components/event-stats/charts';
import { DASH, formatCount, formatFt, formatOne, formatRate, teamLabel } from '@/components/event-stats/format';
import { EventStatsBody, PlayersTable } from '@/components/event-stats/report';
import { buildPlayersCsv, buildTeamsCsv } from '@/components/event-stats/csv-export';
import type { AdminEventStats, EntryFlagKind, EvaluationRow } from '@/lib/types/event-stats';
import { cn } from '@/lib/utils/utils';

const card = 'rounded-2xl border bg-card';
const th = 'px-3 py-2.5 text-left text-xs font-semibold whitespace-nowrap text-muted-foreground';
const td = 'px-3 py-2.5 whitespace-nowrap';
const num = 'text-right tabular-nums';

const FLAG_LABELS: Record<EntryFlagKind, string> = {
  excluded: "Don't count",
  distance_override: 'Distance override',
  distance_mismatch: 'Distance ≠ zone',
};

const WARNING_LABELS: Record<AdminEventStats['warnings'][number]['kind'], string> = {
  unreliable_putts: 'No reliable putt counts',
  override_conflict: 'Override conflicts with frames',
  manual_only: 'Manual-only override',
  zero_frames: 'Zero frames',
};

function download(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function decisionLabel(row: EvaluationRow): { text: string; tone: 'success' | 'warning' | 'neutral' | 'outline' } {
  if (row.skip_reason === 'excluded') return { text: "Skipped · don't count", tone: 'outline' };
  if (row.skip_reason === 'period_changed') return { text: 'Skipped · zone changed', tone: 'outline' };
  if (row.decision === 'promote') return { text: row.applied ? `Moved to Zone ${row.new_zone ?? row.zone - 1}` : 'Move up', tone: 'success' };
  if (row.decision === 'demote') {
    if (row.applied) return { text: `Moved to Zone ${row.new_zone ?? row.zone + 1}`, tone: 'warning' };
    return { text: row.resolution ? `Flagged · ${row.resolution}` : 'Flagged for review', tone: 'warning' };
  }
  return { text: 'Stay', tone: 'neutral' };
}

function SectionHeading({ id, title, caption }: { id: string; title: string; caption?: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <h2 id={id} className="text-xl font-bold">{title}</h2>
      {caption && <span className="text-xs text-muted-foreground">{caption}</span>}
    </div>
  );
}

function range(value: { min: number; max: number; events: number } | null, format: (v: number) => string) {
  return value ? `${format(value.min)}–${format(value.max)} across ${value.events} earlier event${value.events === 1 ? '' : 's'}` : 'No earlier same-type events';
}

export function EventStatsTab({ eventId }: { eventId: string }) {
  const [stats, setStats] = useState<AdminEventStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/event/${eventId}/stats`, { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to load stats');
      setStats(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load stats');
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => { load(); }, [load]);

  if (!stats) {
    return loading ? (
      <div className="animate-pulse space-y-4" aria-label="Loading stats">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[1, 2, 3, 4].map((i) => <div key={i} className="h-28 rounded-2xl bg-muted" />)}</div>
        <div className="h-64 rounded-2xl bg-muted" />
      </div>
    ) : (
      <div className={cn(card, 'py-10 text-center')}>
        <p className="text-muted-foreground">{error}</p>
        <Button onClick={load} className="mt-4"><RefreshCw className="mr-2 size-4" />Retry</Button>
      </div>
    );
  }

  const flagsByEntry = new Map<string, EntryFlagKind[]>();
  for (const flag of stats.entry_flags) flagsByEntry.set(flag.entry_id, [...(flagsByEntry.get(flag.entry_id) ?? []), flag.flag]);
  const date = stats.event.event_date;
  const singles = stats.event.team_size === 1;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Everything in the public report, plus organizer-only data. Never cached.
          {stats.children.map((child) => (
            <span key={child.id} className="ml-2 inline-flex items-center gap-1.5">
              <Link href={`/admin/event/${child.id}`} className="text-info hover:underline">Second chance</Link>
              {child.status === 'created' || child.status === 'pre-bracket'
                ? <StatusBadge tone="outline">{child.status === 'created' ? 'Created' : 'Pre-bracket'} · not public yet</StatusBadge>
                : <StatusBadge tone="neutral">Public</StatusBadge>}
            </span>
          ))}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" asChild><Link href={`/event/${eventId}/stats`}>Open public report</Link></Button>
          <Button variant="outline" onClick={load} disabled={loading}><RefreshCw className={cn('mr-2 size-4', loading && 'animate-spin')} />Refresh</Button>
        </div>
      </div>

      {stats.warnings.length > 0 && (
        <section aria-labelledby="warn-h" className="flex flex-col gap-2 rounded-2xl border border-warning/40 bg-warning/5 p-4">
          <h2 id="warn-h" className="flex items-center gap-2 font-bold">
            <AlertTriangle className="size-4 text-warning" aria-hidden="true" />
            Data warnings <span className="font-medium text-muted-foreground">· {stats.warnings.length}</span>
          </h2>
          <ul className="flex flex-col">
            {stats.warnings.map((w, i) => (
              <li key={i} className="flex flex-wrap gap-x-4 gap-y-1 border-t border-warning/20 py-2 text-sm">
                <span className="w-56 shrink-0 font-semibold text-warning">{WARNING_LABELS[w.kind]}</span>
                <span className="min-w-0 flex-1">{w.match_number !== null ? `M${w.match_number}: ` : ''}{w.detail}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {stats.entry_flags.length > 0 && (
        <section aria-labelledby="flags-h" className="flex flex-col gap-3">
          <SectionHeading id="flags-h" title="Entry flags" caption="Admin only" />
          <div className={cn(card, 'overflow-x-auto')}>
            <table className="w-full text-sm">
              <thead className="border-b">
                <tr>
                  <th scope="col" className={th}>Player</th>
                  <th scope="col" className={th}>Flag</th>
                  <th scope="col" className={th}>Zone distance</th>
                  <th scope="col" className={th}>Putted from</th>
                  <th scope="col" className={th}>Note</th>
                </tr>
              </thead>
              <tbody>
                {stats.entry_flags.map((f) => (
                  <tr key={`${f.entry_id}:${f.flag}`} className="border-b last:border-0">
                    <td className={cn(td, 'font-semibold')}>{f.name}</td>
                    <td className={td}><StatusBadge tone="warning">{FLAG_LABELS[f.flag]}</StatusBadge></td>
                    <td className={td}>{f.zone !== null ? `Zone ${f.zone}${f.zone_distance_ft !== null ? ` · ${formatFt(f.zone_distance_ft)}` : ''}` : DASH}</td>
                    <td className={td}>{formatFt(f.distance_ft)}</td>
                    <td className={cn(td, 'whitespace-normal text-muted-foreground')}>{f.note ?? (f.flag === 'distance_mismatch' ? "Entry distance differs from the zone's event distance." : DASH)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <EventStatsBody
        stats={stats}
        playersTable={
          <PlayersTable
            stats={stats}
            defaultWithinZone="make"
            flagsFor={(entryId) => (flagsByEntry.get(entryId) ?? []).map((flag) => (
              <StatusBadge key={flag} tone="warning" className="mr-1">{FLAG_LABELS[flag]}</StatusBadge>
            ))}
          />
        }
      />

      {!singles && (
        <section aria-labelledby="teams-h" className="flex flex-col gap-3">
          <SectionHeading id="teams-h" title="Teams" caption="Frame performance per member · zero-frame members count as 0" />
          <div className={cn(card, 'overflow-x-auto')}>
            <table className="w-full text-sm">
              <thead className="border-b">
                <tr>
                  <th scope="col" className={th}>{stats.event.status === 'completed' ? 'Place' : 'Seed'}</th>
                  <th scope="col" className={th}>Team</th>
                  <th scope="col" className={cn(th, 'text-right')}>W–L</th>
                  <th scope="col" className={cn(th, 'text-right')}>Make %</th>
                  <th scope="col" className={cn(th, 'text-right')}>Pts / match</th>
                  <th scope="col" className={th}>Members (make % · pts / match)</th>
                </tr>
              </thead>
              <tbody>
                {stats.teams.map((t) => (
                  <tr key={t.team_id} className="border-b last:border-0">
                    <td className={cn(td, 'font-score text-lg font-bold')}>{(stats.event.status === 'completed' ? t.placement : t.seed) ?? DASH}</td>
                    <td className={cn(td, 'font-semibold')}>{teamLabel(t.members)}</td>
                    <td className={cn(td, num)}>{t.wins}–{t.losses}</td>
                    <td className={cn(td, num)}>{formatRate(t.line.make_rate)}</td>
                    <td className={cn(td, num, 'font-semibold')}>{formatOne(t.line.points_per_match)}</td>
                    <td className={cn(td, 'whitespace-normal text-muted-foreground')}>
                      {t.members.map((m) => (
                        <span key={m.entry_id} className={cn('mr-3 inline-block', m.line.frames === 0 && 'text-warning')}>
                          {m.name}: {m.line.frames === 0 ? 'no frames' : `${formatRate(m.line.make_rate)} · ${formatOne(m.line.points_per_match)}`}
                        </span>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {stats.evaluations.state !== 'none' && (
        <section aria-labelledby="eval-h" className="flex flex-col gap-3">
          <SectionHeading id="eval-h" title="Handicap evaluations after this event" caption="Run when the event completed · pending flags are never shown to players" />
          {stats.evaluations.state === 'pending' ? (
            <div className={cn(card, 'p-4 text-sm')}>
              <p className="font-semibold">Evaluated when the event completes</p>
              <p className="text-muted-foreground">Zone decisions run once, at completion. Nothing moves during a live event.</p>
            </div>
          ) : (
            <>
              <div className={cn(card, 'overflow-x-auto')}>
                <table className="w-full text-sm">
                  <thead className="border-b">
                    <tr>
                      <th colSpan={4} />
                      <th colSpan={3} className="border-b border-dashed border-warning/50 px-3 pt-2 pb-1.5 text-left text-[11px] font-semibold tracking-wide text-warning uppercase">
                        Evaluation window (may include earlier events)
                      </th>
                    </tr>
                    <tr>
                      <th scope="col" className={th}>Player</th>
                      <th scope="col" className={th}>Zone</th>
                      <th scope="col" className={th}>Decision</th>
                      <th scope="col" className={th}>Eligibility</th>
                      <th scope="col" className={cn(th, 'text-right')}>Putts</th>
                      <th scope="col" className={cn(th, 'text-right')}>Matches</th>
                      <th scope="col" className={cn(th, 'text-right')}>Make %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.evaluations.rows.map((row) => {
                      const decision = decisionLabel(row);
                      return (
                        <tr key={row.player_id} className="border-b last:border-0">
                          <td className={cn(td, 'font-semibold')}>{row.name}</td>
                          <td className={td}><ZoneBadge zone={row.zone} distanceFt={null} size="sm" /></td>
                          <td className={td}><StatusBadge tone={decision.tone}>{decision.text}</StatusBadge></td>
                          <td className={cn(td, 'text-muted-foreground')}>{row.skip_reason ? DASH : row.eligible ? 'Eligible' : 'Not yet'}</td>
                          <td className={cn(td, num)}>{row.window.putts_attempted}</td>
                          <td className={cn(td, num)}>{row.window.matches}</td>
                          <td className={cn(td, num, 'font-semibold')}>{row.window.make_pct === null ? DASH : `${row.window.make_pct.toFixed(1)}%`}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-muted-foreground">The window is the player&apos;s recent putts in their zone (whole events, possibly with qualification), not this event alone.</p>
            </>
          )}
        </section>
      )}

      {stats.qualification && (
        <section aria-labelledby="qual-h" className="flex flex-col gap-3">
          <SectionHeading id="qual-h" title="Qualification" caption="Admin only after qualification closes · never part of the bracket numbers above" />
          <div className={cn(card, 'overflow-x-auto')}>
            <table className="w-full text-sm">
              <thead className="border-b">
                <tr>
                  <th scope="col" className={th}>Player</th>
                  <th scope="col" className={cn(th, 'text-right')}>Frames</th>
                  <th scope="col" className={cn(th, 'text-right')}>Make %</th>
                  <th scope="col" className={cn(th, 'text-right')}>Points</th>
                </tr>
              </thead>
              <tbody>
                {stats.qualification.map((q) => (
                  <tr key={q.entry_id} className="border-b last:border-0">
                    <td className={cn(td, 'font-semibold')}>{q.name}</td>
                    <td className={cn(td, num)}>{q.frames}</td>
                    <td className={cn(td, num)}>{formatRate(q.make_rate)}</td>
                    <td className={cn(td, num, 'font-semibold')}>{q.points}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section aria-labelledby="analytics-h" className="flex flex-col gap-3">
        <SectionHeading id="analytics-h" title="Analytics" caption="Admin only · definitions in the footnotes" />
        <div className="grid gap-3 lg:grid-cols-3">
          <div className={cn(card, 'flex flex-col gap-2 p-4 text-sm')}>
            <h3 className="font-bold">Spread</h3>
            <p>
              Player PPF SD: <span className="font-semibold tabular-nums">{stats.analytics.spread.player_ppf_sd?.toFixed(2) ?? DASH}</span>
              <span className="text-muted-foreground"> ({stats.analytics.spread.players_counted} players with 10+ frames)</span>
            </p>
            <p className="text-xs text-muted-foreground">League: {range(stats.analytics.spread.league_player_ppf_sd, (v) => v.toFixed(2))}</p>
            {!singles && (
              <>
                <p>
                  Team pts / match SD: <span className="font-semibold tabular-nums">{stats.analytics.spread.team_ppm_sd?.toFixed(2) ?? DASH}</span>
                  <span className="text-muted-foreground"> ({stats.analytics.spread.teams_counted} teams)</span>
                </p>
                <p className="text-xs text-muted-foreground">League: {range(stats.analytics.spread.league_team_ppm_sd, (v) => v.toFixed(2))}</p>
              </>
            )}
            <p className="text-xs text-muted-foreground">Includes &quot;don&apos;t count&quot; entries: spread describes the night, not the handicap decision.</p>
          </div>
          <div className={cn(card, 'flex flex-col gap-2 p-4 text-sm')}>
            <h3 className="font-bold">Strength vs. finish</h3>
            {stats.analytics.strength.available ? (
              <>
                <p>
                  Rank correlation: <span className="font-semibold tabular-nums">{stats.analytics.strength.rho?.toFixed(2) ?? DASH}</span>
                  <span className="text-muted-foreground"> ({stats.analytics.strength.teams_counted} {singles ? 'players' : 'teams'})</span>
                </p>
                {stats.analytics.strength.teams_without_history > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {stats.analytics.strength.teams_without_history} left out: a member has no earlier frames in this league.
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  Spearman, ties averaged. Strength = members&apos; season points per frame, summed (not seed). 1 = the strongest on paper finished best.
                </p>
              </>
            ) : (
              <p className="text-muted-foreground">Available after the event completes.</p>
            )}
          </div>
          <div className={cn(card, 'flex flex-col gap-2 p-4 text-sm')}>
            <h3 className="font-bold">Season vs. this event · make %</h3>
            <SeasonScatter points={stats.analytics.scatter.map((p) => ({ id: p.entry_id, label: p.name, zone: p.zone, x: p.season_rate, y: p.event_rate }))} />
          </div>
        </div>
      </section>

      <section aria-labelledby="export-h" className={cn(card, 'flex flex-col gap-3 p-4')}>
        <h2 id="export-h" className="font-bold">Export</h2>
        <p className="text-sm text-muted-foreground">Raw counts plus the displayed metrics, one row per entry{singles ? '' : ' or team'}.</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => download(`players-${date}.csv`, buildPlayersCsv(stats))}>
            <Download className="mr-2 size-4" />Players CSV
          </Button>
          {!singles && (
            <Button variant="outline" onClick={() => download(`teams-${date}.csv`, buildTeamsCsv(stats))}>
              <Download className="mr-2 size-4" />Teams CSV
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">{formatCount(stats.players.length)} players · {formatCount(stats.teams.length)} teams</p>
      </section>
    </div>
  );
}
