/**
 * The public boundary of the event report. Types are erased at runtime, so this
 * mapper copies only allowlisted fields into fresh objects: anything added to the
 * model later stays out of the public response until it is added here.
 */
import { isBracketPubliclyVisible } from '@/lib/services/auth/visibility';
import type { StatsLinkedEvent } from '@/lib/repositories/event-stats-repository.db';
import type {
  LinkedEventRef,
  MatchFact,
  PlayerRow,
  PublicEventStats,
  SeasonLine,
  StandingRow,
  StatLine,
  StatsMember,
  ZoneGroup,
} from '@/lib/types/event-stats';
import type { EventStatsModel } from './build';

const line = (l: StatLine): StatLine => ({
  frames: l.frames,
  made: l.made,
  points: l.points,
  threes: l.threes,
  make_rate: l.make_rate,
  points_per_match: l.points_per_match,
});

const season = (s: SeasonLine | null): SeasonLine | null =>
  s && { label: s.label, frames: s.frames, make_rate: s.make_rate, points_per_match: s.points_per_match };

const member = (m: StatsMember): StatsMember => ({ entry_id: m.entry_id, player_number: m.player_number, name: m.name });

const fact = (f: MatchFact | null): MatchFact | null =>
  f && {
    match_id: f.match_id,
    number: f.number,
    side1: f.side1,
    side2: f.side2,
    score1: f.score1,
    score2: f.score2,
    overtime: f.overtime,
  };

const standing = (s: StandingRow): StandingRow => ({
  team_id: s.team_id,
  seed: s.seed,
  placement: s.placement,
  members: s.members.map(member),
  wins: s.wins,
  losses: s.losses,
  status: s.status,
  lane: s.lane,
  line: line(s.line),
});

const player = (p: PlayerRow): PlayerRow => ({
  entry_id: p.entry_id,
  player_number: p.player_number,
  name: p.name,
  zone: p.zone,
  distance_ft: p.distance_ft,
  team_id: p.team_id,
  line: line(p.line),
  matches: p.matches,
  best_match: p.best_match,
  small_sample: p.small_sample,
  zone_moved: p.zone_moved,
  season: season(p.season),
});

const zoneGroup = (z: ZoneGroup): ZoneGroup => ({
  zone: z.zone,
  distance_ft: z.distance_ft,
  off_nominal: z.off_nominal,
  players: z.players,
  line: line(z.line),
  mix: z.mix && [z.mix[0], z.mix[1], z.mix[2], z.mix[3]],
  best: z.best && { name: z.best.name, player_number: z.best.player_number, make_rate: z.best.make_rate },
});

/** A linked event is linked publicly only once its own bracket is publicly visible. */
export function publicLink(
  linked: StatsLinkedEvent | null,
  linkType: LinkedEventRef['link_type'] | null
): LinkedEventRef | null {
  if (!linked || !linkType) return null;
  if (!isBracketPubliclyVisible({ status: linked.status, qualification_round_enabled: false })) return null;
  return { id: linked.id, link_type: linkType, event_date: linked.event_date };
}

export function toPublicEventStats(
  model: EventStatsModel,
  links: { parent: StatsLinkedEvent | null; children: readonly StatsLinkedEvent[] },
  generatedAt: string
): PublicEventStats {
  const r = model.report;
  const child = links.children
    .map((c) => publicLink(c, c.link_type))
    .find((c): c is LinkedEventRef => c !== null) ?? null;
  return {
    event: {
      id: r.event.id,
      league_id: r.event.league_id,
      league_name: r.event.league_name,
      event_date: r.event.event_date,
      location: r.event.location,
      status: r.event.status,
      bonus_point_enabled: r.event.bonus_point_enabled,
      frames_per_match: r.event.frames_per_match,
      team_size: r.event.team_size,
      handicap_enabled: r.event.handicap_enabled,
      putt_distance_ft: r.event.putt_distance_ft,
      putt_counts_reliable: r.event.putt_counts_reliable,
      link_type: r.event.link_type,
    },
    parent: publicLink(links.parent, r.event.link_type),
    child,
    progress: { completed: r.progress.completed, in_progress: r.progress.in_progress, total: r.progress.total },
    counts: { players: r.counts.players, teams: r.counts.teams, matches: r.counts.matches },
    zones: r.zones.map((z) => ({ zone: z.zone, distance_ft: z.distance_ft, players: z.players })),
    field: line(r.field),
    close_matches: r.close_matches,
    overtime_matches: r.overtime_matches,
    season: r.season && { field: season(r.season.field) },
    standings: r.standings.map(standing),
    players: r.players.map(player),
    zone_groups: r.zone_groups.map(zoneGroup),
    matches: {
      completed: r.matches.completed,
      margins: r.matches.margins.map((m) => ({ margin: m.margin, count: m.count })),
      closest: fact(r.matches.closest),
      highest: fact(r.matches.highest),
      overtime: r.matches.overtime.map((f) => fact(f)!),
    },
    generated_at: generatedAt,
  };
}
