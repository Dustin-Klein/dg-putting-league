'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, ChevronLeft } from 'lucide-react';
import { cn } from '@/lib/utils/utils';
import { formatDisplayDate } from '@/lib/utils/date-utils';
import { StatusBadge } from '@/components/status-badge';
import { ZoneBadge } from '@/components/zone-badge';
import type { MatchFact, PlayerRow, PublicEventStats, StandingRow, ZoneGroup } from '@/lib/types/event-stats';
import { MarginHistogram, PuttsMixBar } from './charts';
import { DASH, formatCount, formatFt, formatOne, formatRate, teamLabel } from './format';

function SectionHeading({ id, title, caption }: { id: string; title: string; caption?: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <h2 id={id} className="text-xl font-bold">{title}</h2>
      {caption && <span className="text-xs text-muted-foreground">{caption}</span>}
    </div>
  );
}

const card = 'rounded-2xl border bg-card';
const th = 'px-3 py-2.5 text-left text-xs font-semibold whitespace-nowrap text-muted-foreground';
const td = 'px-3 py-2.5 whitespace-nowrap';
const num = 'text-right tabular-nums';

export function StatsHeader({ stats, live, actions }: { stats: PublicEventStats; live: boolean; actions?: React.ReactNode }) {
  const e = stats.event;
  const facts = [
    e.location,
    `${stats.counts.players} players`,
    e.team_size === 1 ? null : `${stats.counts.teams} ${e.team_size === 2 ? 'doubles teams' : 'teams'}`,
    `${stats.counts.matches} matches`,
    `${e.frames_per_match} frames per match`,
    `Bonus point ${e.bonus_point_enabled ? 'on' : 'off'}`,
    e.handicap_enabled ? null : formatFt(e.putt_distance_ft),
  ].filter(Boolean);
  return (
    <header className="flex flex-col gap-4">
      <Link href={`/leagues/${e.league_id}`} className="inline-flex min-h-8 w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4" aria-hidden="true" />
        {e.league_name}
      </Link>
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="text-xs font-bold tracking-[0.08em] text-muted-foreground uppercase">
              {e.link_type === 'second_chance' ? 'Second chance stats' : 'Event stats'}
            </span>
            {live ? (
              <StatusBadge tone="success" dot>
                In progress · {stats.progress.completed} of {stats.progress.total} matches complete
              </StatusBadge>
            ) : (
              <StatusBadge tone="neutral">Final</StatusBadge>
            )}
          </div>
          <h1 className="font-score text-5xl leading-[0.95] font-bold">{formatDisplayDate(e.event_date)}</h1>
          <p className="flex flex-wrap gap-x-3.5 gap-y-1 text-sm text-muted-foreground">
            {facts.map((fact) => <span key={fact}>{fact}</span>)}
          </p>
          {stats.zones.length > 0 && (
            <ul className="flex flex-wrap gap-2" aria-label="Zones">
              {stats.zones.map((z) => (
                <li key={z.zone} className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <ZoneBadge zone={z.zone} distanceFt={z.distance_ft} size="sm" />
                  <span>{z.players} players</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <nav aria-label="Related" className="flex flex-wrap gap-2">
          <Link href={`/event/${e.id}/bracket`} className="inline-flex min-h-11 items-center rounded-xl border bg-card px-4 text-sm font-semibold hover:bg-muted">
            View bracket
          </Link>
          {stats.parent && (
            <Link href={`/event/${stats.parent.id}/stats`} className="inline-flex min-h-11 items-center rounded-xl border bg-card px-4 text-sm font-semibold hover:bg-muted">
              Main event stats
            </Link>
          )}
          {stats.child && (
            <Link href={`/event/${stats.child.id}/stats`} className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border bg-card px-4 text-sm font-semibold hover:bg-muted">
              Second chance stats
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          )}
          {actions}
        </nav>
      </div>
    </header>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className={cn(card, 'flex flex-col gap-1.5 p-4')}>
      <span className="text-[13px] font-semibold text-muted-foreground">{label}</span>
      <span className="font-score text-[40px] leading-none font-bold tabular-nums">{value}</span>
      <span className="text-xs text-muted-foreground">{sub}</span>
    </div>
  );
}

export function StatTiles({ stats }: { stats: PublicEventStats }) {
  const season = stats.season?.field;
  return (
    <section aria-label="Headline stats" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Tile
        label="Field make %"
        value={formatRate(stats.field.make_rate)}
        sub={stats.event.putt_counts_reliable
          ? `Frame performance · ${stats.field.frames} frames${season ? ` · season ${formatRate(season.make_rate)}` : ''}`
          : 'Imported scores: points only'}
      />
      <Tile
        label="Field pts / match"
        value={formatOne(stats.field.points_per_match)}
        sub={`Frame performance · per player${season ? ` · season ${formatOne(season.points_per_match)}` : ''}`}
      />
      <Tile label="Matches decided by ≤ 2" value={String(stats.close_matches)} sub={`Official results · of ${stats.matches.completed} complete`} />
      <Tile label="Overtime matches" value={String(stats.overtime_matches)} sub="Official results · sudden death" />
    </section>
  );
}

function statusBadge(row: StandingRow) {
  if (row.status === 'playing') return <StatusBadge tone="neutral" dot>Playing{row.lane ? ` · ${row.lane}` : ''}</StatusBadge>;
  if (row.status === 'in') return <StatusBadge tone="success">Still in</StatusBadge>;
  if (row.status === 'out') return <StatusBadge tone="outline">Out</StatusBadge>;
  return null;
}

export function Standings({ stats }: { stats: PublicEventStats }) {
  const live = stats.event.status === 'bracket';
  const singles = stats.event.team_size === 1;
  return (
    <section aria-labelledby="standings-h" className="flex flex-col gap-3">
      <SectionHeading
        id="standings-h"
        title={live ? 'Standings so far' : 'Standings'}
        caption={live ? 'Seed and W–L: official results · placement appears when the event completes' : `Place and W–L: official results · ${singles ? 'player' : 'team'} columns: frame performance`}
      />
      <ul className={cn(card, 'md:hidden')}>
        {stats.standings.map((row) => (
          <li key={row.team_id} className={cn('flex items-center gap-3 border-b px-3 py-2.5 last:border-0', row.status === 'out' && 'text-muted-foreground')}>
            <span className="w-6 shrink-0 font-score text-lg font-bold">{(live ? row.seed : row.placement) ?? DASH}</span>
            <span className="min-w-0 flex-1 text-sm font-semibold">{teamLabel(row.members)}</span>
            <span className="text-sm tabular-nums">{row.wins}–{row.losses}</span>
            {live ? statusBadge(row) : (
              <span className="text-right text-xs text-muted-foreground tabular-nums">
                {formatRate(row.line.make_rate)}<br />{formatOne(row.line.points_per_match)} pts
              </span>
            )}
          </li>
        ))}
      </ul>
      <div className={cn(card, 'hidden overflow-x-auto md:block')}>
        <table className="w-full text-sm">
          <thead className="border-b">
            <tr>
              <th scope="col" className={cn(th, 'w-16')}>{live ? 'Seed' : 'Place'}</th>
              <th scope="col" className={th}>{singles ? 'Player' : 'Team'}</th>
              <th scope="col" className={cn(th, 'text-right')}>W–L</th>
              {live ? (
                <th scope="col" className={th}>Status</th>
              ) : (
                <>
                  <th scope="col" className={cn(th, 'text-right')}>{singles ? 'Make %' : 'Team make %'}</th>
                  <th scope="col" className={cn(th, 'text-right')}>{singles ? 'Pts / match' : 'Team pts / match'}</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {stats.standings.map((row) => (
              <tr key={row.team_id} className={cn('border-b last:border-0', row.status === 'out' && 'text-muted-foreground')}>
                <td className={cn(td, 'font-score text-xl font-bold')}>{(live ? row.seed : row.placement) ?? DASH}</td>
                <td className={cn(td, 'font-semibold whitespace-normal')}>{teamLabel(row.members)}</td>
                <td className={cn(td, num)}>{row.wins}–{row.losses}</td>
                {live ? (
                  <td className={td}>{statusBadge(row)}</td>
                ) : (
                  <>
                    <td className={cn(td, num)}>{formatRate(row.line.make_rate)}</td>
                    <td className={cn(td, num, 'font-semibold')}>{formatOne(row.line.points_per_match)}</td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

type SortKey = 'zone' | 'name' | 'make' | 'ppm' | 'frames' | 'matches' | 'threes' | 'best' | 'season';

interface Column {
  key: SortKey;
  label: string;
  right?: boolean;
}

function compareNullable(a: number | null, b: number | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return b - a;
}

function sortPlayers(players: readonly PlayerRow[], key: SortKey, defaultWithinZone: 'name' | 'make'): PlayerRow[] {
  const byName = (a: PlayerRow, b: PlayerRow) => a.name.localeCompare(b.name, undefined, { numeric: true });
  const byMake = (a: PlayerRow, b: PlayerRow) => compareNullable(a.line.make_rate, b.line.make_rate) || byName(a, b);
  const cmp: Record<SortKey, (a: PlayerRow, b: PlayerRow) => number> = {
    zone: (a, b) => (a.zone ?? 0) - (b.zone ?? 0) || (defaultWithinZone === 'make' ? byMake(a, b) : byName(a, b)),
    name: byName,
    make: byMake,
    ppm: (a, b) => compareNullable(a.line.points_per_match, b.line.points_per_match) || byName(a, b),
    frames: (a, b) => b.line.frames - a.line.frames || byName(a, b),
    matches: (a, b) => b.matches - a.matches || byName(a, b),
    threes: (a, b) => compareNullable(a.line.threes, b.line.threes) || byName(a, b),
    best: (a, b) => compareNullable(a.best_match, b.best_match) || byName(a, b),
    season: (a, b) => compareNullable(a.season?.make_rate ?? null, b.season?.make_rate ?? null) || byName(a, b),
  };
  return [...players].sort(cmp[key]);
}

export function PlayersTable({
  stats,
  defaultWithinZone = 'name',
  flagsFor,
}: {
  stats: PublicEventStats;
  /** Public: zone then name. Admin: make % within each zone. */
  defaultWithinZone?: 'name' | 'make';
  flagsFor?: (entryId: string) => React.ReactNode;
}) {
  const handicap = stats.event.handicap_enabled;
  const [sortKey, setSortKey] = useState<SortKey>(handicap ? 'zone' : defaultWithinZone === 'make' ? 'make' : 'name');
  const sorted = useMemo(() => sortPlayers(stats.players, sortKey, defaultWithinZone), [stats.players, sortKey, defaultWithinZone]);
  const hasSeason = stats.players.some((p) => p.season?.make_rate != null);
  const columns: Column[] = [
    { key: 'name', label: 'Player' },
    { key: 'zone', label: handicap ? 'Zone' : 'Distance' },
    { key: 'make', label: 'Make %', right: true },
    { key: 'ppm', label: 'Pts / match', right: true },
    { key: 'frames', label: 'Frames', right: true },
    { key: 'matches', label: 'Matches', right: true },
    { key: 'threes', label: '3-for-3', right: true },
    { key: 'best', label: 'Best match', right: true },
    ...(hasSeason ? [{ key: 'season' as const, label: 'Season make %', right: true }] : []),
  ];
  const label = columns.find((c) => c.key === sortKey)?.label ?? '';
  const sortLabel = sortKey === 'zone' ? (defaultWithinZone === 'make' ? 'zone, then make %' : 'zone, then name') : label.toLowerCase();

  return (
    <section aria-labelledby="players-h" className="flex flex-col gap-3">
      <SectionHeading id="players-h" title="Players" caption={`Frame performance · sorted by ${sortLabel} · dimmed rows have fewer than 10 frames`} />
      <label className="flex items-center gap-2 text-sm text-muted-foreground md:hidden">
        Sort
        <select
          value={sortKey}
          onChange={(event) => setSortKey(event.target.value as SortKey)}
          className="min-h-11 flex-1 rounded-lg border bg-card px-2 text-foreground"
        >
          {columns.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
        </select>
      </label>

      <ul className="flex flex-col gap-2 md:hidden">
        {sorted.map((p) => (
          <li key={p.entry_id} className={cn(card, 'flex items-center gap-3 p-3', p.small_sample && 'opacity-60')}>
            {p.zone !== null && <ZoneBadge zone={p.zone} distanceFt={null} size="sm" />}
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <Link href={`/player/${p.player_number}`} className="truncate text-sm font-semibold hover:underline">{p.name}</Link>
              <span className="text-xs text-muted-foreground">
                {formatFt(p.distance_ft)}{p.zone_moved ? ' (moved mid-event)' : ''} · {p.line.frames} frames{p.line.threes !== null ? ` · ${p.line.threes}× 3-for-3` : ''}
                {p.season?.make_rate != null ? ` · season ${formatRate(p.season.make_rate)}` : ''}
              </span>
              {flagsFor?.(p.entry_id)}
            </div>
            <div className="flex flex-col items-end gap-0.5">
              <span className="font-score text-[22px] leading-none font-bold tabular-nums">{formatRate(p.line.make_rate)}</span>
              <span className="text-xs text-muted-foreground">{formatOne(p.line.points_per_match)} pts / match</span>
            </div>
          </li>
        ))}
      </ul>

      <div className={cn(card, 'hidden overflow-x-auto md:block')}>
        <table className="w-full text-sm">
          <thead className="border-b">
            <tr>
              {columns.map((c) => (
                <th key={c.key} scope="col" aria-sort={sortKey === c.key ? 'descending' : undefined} className="p-0">
                  <button
                    type="button"
                    onClick={() => setSortKey(c.key)}
                    className={cn(th, 'block min-h-10 w-full hover:bg-muted hover:text-foreground', c.right && 'text-right', sortKey === c.key && 'text-foreground')}
                  >
                    {c.label}{sortKey === c.key ? (c.key === 'name' || c.key === 'zone' ? ' ↑' : ' ↓') : ''}
                  </button>
                </th>
              ))}
              {flagsFor && <th scope="col" className={th}>Flags</th>}
            </tr>
          </thead>
          <tbody>
            {sorted.map((p) => (
              <tr key={p.entry_id} className={cn('border-b last:border-0', p.small_sample && 'opacity-60')}>
                <td className={cn(td, 'font-semibold')}>
                  <Link href={`/player/${p.player_number}`} className="hover:underline">{p.name}</Link>
                </td>
                <td className={td}>
                  <span className="inline-flex items-center gap-2">
                    {p.zone !== null && <ZoneBadge zone={p.zone} distanceFt={null} size="sm" />}
                    <span className="text-muted-foreground">{formatFt(p.distance_ft)}</span>
                    {p.zone_moved && <span className="text-xs text-muted-foreground">· moved mid-event</span>}
                  </span>
                </td>
                <td className={cn(td, num, 'font-semibold')}>{formatRate(p.line.make_rate)}</td>
                <td className={cn(td, num, 'font-semibold')}>{formatOne(p.line.points_per_match)}</td>
                <td className={cn(td, num)}>{p.line.frames}{p.small_sample && p.line.frames > 0 ? ' · small sample' : ''}</td>
                <td className={cn(td, num)}>{p.matches}</td>
                <td className={cn(td, num)}>{formatCount(p.line.threes)}</td>
                <td className={cn(td, num)}>{formatCount(p.best_match)}</td>
                {hasSeason && (
                  <td className={cn(td, num)} title={p.season ? `${p.season.label} · ${p.season.frames} frames` : undefined}>
                    {formatRate(p.season?.make_rate)}
                  </td>
                )}
                {flagsFor && <td className={td}>{flagsFor(p.entry_id)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        Make % = putts made ÷ putts attempted (the bonus point never counts). Pts / match = points per frame × {stats.event.frames_per_match}.
        Best match = most regulation-frame points in one match. Season = earlier completed events in this league
        {handicap ? ', same zone' : ', same distance'}.
      </p>
    </section>
  );
}

function zoneTitle(group: ZoneGroup): string {
  return group.zone !== null ? `Zone ${group.zone} · ${formatFt(group.distance_ft)}` : formatFt(group.distance_ft);
}

export function ZonesSection({ stats }: { stats: PublicEventStats }) {
  if (stats.zone_groups.length === 0) return null;
  const handicap = stats.event.handicap_enabled;
  return (
    <section aria-labelledby="zones-h" className="flex flex-col gap-3">
      <SectionHeading
        id="zones-h"
        title={handicap ? 'Zones and putts mix' : 'Putts mix'}
        caption={handicap ? 'Frame performance · grouped by zone and the distance actually putted' : 'Frame performance'}
      />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {stats.zone_groups.map((group) => (
          <article key={`${group.zone}:${group.distance_ft}`} className={cn(card, 'flex flex-col gap-4 p-4')}>
            <div className="flex flex-wrap items-center gap-2">
              {group.zone !== null && <ZoneBadge zone={group.zone} distanceFt={null} size="sm" />}
              <h3 className="font-bold">{zoneTitle(group)}</h3>
              {group.off_nominal && <StatusBadge tone="warning">Not the zone&apos;s distance</StatusBadge>}
              <span className="ml-auto text-xs text-muted-foreground">{group.players} players · {group.line.frames} frames</span>
            </div>
            <dl className="grid grid-cols-2 gap-3">
              <div>
                <dt className="text-xs text-muted-foreground">Make %</dt>
                <dd className="font-score text-3xl leading-none font-bold tabular-nums">{formatRate(group.line.make_rate)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Pts / match</dt>
                <dd className="font-score text-3xl leading-none font-bold tabular-nums">{formatOne(group.line.points_per_match)}</dd>
              </div>
            </dl>
            {group.mix ? (
              <div className="flex flex-col gap-1.5">
                <span className="text-xs text-muted-foreground">Putts made per frame</span>
                <PuttsMixBar mix={group.mix} label={`Putts made per frame, ${zoneTitle(group)}`} />
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Imported scores: points only. The putts mix isn&apos;t available.</p>
            )}
            {group.best && (
              <p className="text-sm text-muted-foreground">
                Best make %{group.zone !== null ? ` in Zone ${group.zone}` : ''}:{' '}
                <span className="font-semibold text-foreground">{group.best.name}</span> · {formatRate(group.best.make_rate)}
              </p>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}

function Fact({ label, fact, note }: { label: string; fact: MatchFact; note?: string }) {
  return (
    <div className={cn(card, 'flex flex-col gap-1 p-4')}>
      <span className="text-xs font-semibold text-muted-foreground">{label}{fact.number !== null ? ` · M${fact.number}` : ''}</span>
      <span className="text-sm font-semibold">{fact.side1} <span className="text-muted-foreground">vs</span> {fact.side2}</span>
      <span className="font-score text-2xl leading-none font-bold tabular-nums">{fact.score1}–{fact.score2}</span>
      {note && <span className="text-xs text-muted-foreground">{note}</span>}
    </div>
  );
}

export function MatchesSectionView({ stats }: { stats: PublicEventStats }) {
  const m = stats.matches;
  return (
    <section aria-labelledby="matches-h" className="flex flex-col gap-3">
      <SectionHeading
        id="matches-h"
        title="Matches"
        caption={`Official results · ${m.completed} completed matches (BYEs excluded${stats.event.status === 'bracket' ? ', matches in progress left out' : ''})`}
      />
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className={cn(card, 'flex flex-col gap-2 p-4')}>
          <span className="text-sm font-semibold">Winning margin</span>
          <MarginHistogram margins={m.margins} />
          <span className="text-xs text-muted-foreground">Points between the two sides in each match. Margins of 2 or less are close matches.</span>
        </div>
        <div className="flex flex-col gap-3">
          {m.closest && <Fact label="Closest match" fact={m.closest} />}
          {m.highest && <Fact label="Highest-scoring match" fact={m.highest} note="Combined regulation score" />}
          {m.overtime.length > 0 && (
            <div className={cn(card, 'flex flex-col gap-1 p-4')}>
              <span className="text-xs font-semibold text-muted-foreground">Overtime matches</span>
              <ul className="flex flex-col gap-1 text-sm">
                {m.overtime.map((f) => (
                  <li key={f.match_id} className="flex flex-wrap justify-between gap-2">
                    <span>{f.number !== null ? `M${f.number} · ` : ''}{f.side1} vs {f.side2}</span>
                    <span className="tabular-nums font-semibold">{f.score1}–{f.score2}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

export function ReportFooter({ stats }: { stats: PublicEventStats }) {
  return (
    <footer className="flex flex-col gap-1 border-t pt-4 text-xs text-muted-foreground">
      {!stats.event.putt_counts_reliable && <span>Imported scores: points only. Make %, putts mix and 3-for-3 aren&apos;t available for this event.</span>}
      <span>Stats follow the event entry, not the physical thrower.</span>
      <span>Results use official match scores; player stats use scored frames.</span>
    </footer>
  );
}

export function EventStatsBody({ stats, playersTable }: { stats: PublicEventStats; playersTable?: React.ReactNode }) {
  return (
    <>
      <StatTiles stats={stats} />
      <Standings stats={stats} />
      {playersTable ?? <PlayersTable stats={stats} />}
      <ZonesSection stats={stats} />
      <MatchesSectionView stats={stats} />
    </>
  );
}
