import 'server-only';
import { and, asc, desc, eq, inArray, isNotNull, ne, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Executor } from '@/lib/db/tx';
import { toIsoTimestamp } from '@/lib/db/mappers';
import {
  bracket_group,
  bracket_match,
  bracket_participant,
  bracket_round,
  event_placements,
  event_players,
  events,
  frame_results,
  league_admins,
  leagues,
  match_frames,
  players,
  team_members,
  teams,
} from '@/lib/db/schema';
import type { Player } from '@/lib/types/player';

export async function getPlayerByNumber(
  ex: Executor,
  playerNumber: number
): Promise<Player | null> {
  const rows = await ex
    .select({
      id: players.id,
      player_number: players.player_number,
      full_name: players.full_name,
      nickname: players.nickname,
      created_at: players.created_at,
      default_pool: players.default_pool,
    })
    .from(players)
    .where(eq(players.player_number, playerNumber))
    .limit(1);

  const player = rows[0];
  return player ? { ...player, created_at: toIsoTimestamp(player.created_at) } : null;
}

export interface EventParticipation {
  eventPlayerId: string;
  eventId: string;
  eventDate: string;
  pool: 'A' | 'B' | null;
  leagueId: string;
  leagueName: string;
  location: string | null;
  eventStatus: 'created' | 'pre-bracket' | 'bracket' | 'completed';
}

export interface TeamInfo {
  eventPlayerId: string;
  teamId: string;
  seed: number;
  teammateEventPlayerId: string | null;
  teammatePlayerId: string | null;
  teammateName: string | null;
}

export interface ParticipationData {
  participations: EventParticipation[];
  teamInfoMap: Map<string, TeamInfo>;
}

/**
 * Load visible participations and their team/teammate in one query. The visibility
 * predicate mirrors isEventPubliclyVisible in services/auth/visibility.ts; a signed-in
 * league administrator may additionally see that league's private events.
 */
export async function getPlayerParticipations(
  ex: Executor,
  playerId: string,
  viewerId: string | null
): Promise<ParticipationData> {
  const ownMember = alias(team_members, 'profile_own_member');
  const teammateMember = alias(team_members, 'profile_teammate_member');
  const teammateEntry = alias(event_players, 'profile_teammate_entry');
  const teammatePlayer = alias(players, 'profile_teammate_player');
  const viewerAdmin = alias(league_admins, 'profile_viewer_admin');

  const publiclyVisible = or(
    inArray(events.status, ['bracket', 'completed']),
    and(eq(events.status, 'pre-bracket'), eq(events.qualification_round_enabled, true))
  );
  const visibility = viewerId
    ? or(publiclyVisible, isNotNull(viewerAdmin.id))
    : publiclyVisible;

  let query = ex
    .select({
      eventPlayerId: event_players.id,
      eventId: events.id,
      eventDate: events.event_date,
      pool: event_players.pool,
      leagueId: events.league_id,
      leagueName: leagues.name,
      location: events.location,
      eventStatus: events.status,
      teamId: teams.id,
      seed: teams.seed,
      teammateEventPlayerId: teammateMember.event_player_id,
      teammatePlayerId: teammateEntry.player_id,
      teammateName: teammatePlayer.full_name,
    })
    .from(event_players)
    .innerJoin(events, eq(events.id, event_players.event_id))
    .innerJoin(leagues, eq(leagues.id, events.league_id))
    .leftJoin(ownMember, eq(ownMember.event_player_id, event_players.id))
    .leftJoin(teams, eq(teams.id, ownMember.team_id))
    .leftJoin(
      teammateMember,
      and(eq(teammateMember.team_id, teams.id), ne(teammateMember.event_player_id, event_players.id))
    )
    .leftJoin(teammateEntry, eq(teammateEntry.id, teammateMember.event_player_id))
    .leftJoin(teammatePlayer, eq(teammatePlayer.id, teammateEntry.player_id));

  if (viewerId) {
    query = query.leftJoin(
      viewerAdmin,
      and(eq(viewerAdmin.league_id, events.league_id), eq(viewerAdmin.user_id, viewerId))
    );
  }

  const rows = await query
    .where(and(eq(event_players.player_id, playerId), visibility))
    .orderBy(desc(event_players.created_at), asc(teammateMember.slot));

  const participations: EventParticipation[] = [];
  const teamInfoMap = new Map<string, TeamInfo>();
  const seen = new Set<string>();

  for (const row of rows) {
    if (!seen.has(row.eventPlayerId)) {
      seen.add(row.eventPlayerId);
      participations.push({
        eventPlayerId: row.eventPlayerId,
        eventId: row.eventId,
        eventDate: row.eventDate,
        pool: row.pool,
        leagueId: row.leagueId,
        leagueName: row.leagueName,
        location: row.location,
        eventStatus: row.eventStatus,
      });
    }

    const known = teamInfoMap.get(row.eventPlayerId);
    if (known && row.teammateName) {
      // Teams of three or more: one row per teammate, joined in slot order.
      known.teammateName = known.teammateName ? `${known.teammateName} & ${row.teammateName}` : row.teammateName;
    } else if (row.teamId && row.seed !== null && !known) {
      teamInfoMap.set(row.eventPlayerId, {
        eventPlayerId: row.eventPlayerId,
        teamId: row.teamId,
        seed: row.seed,
        teammateEventPlayerId: row.teammateEventPlayerId,
        teammatePlayerId: row.teammatePlayerId,
        teammateName: row.teammateName,
      });
    }
  }

  return { participations, teamInfoMap };
}

export interface FrameResultData {
  eventPlayerId: string;
  bracketMatchId: number | null;
  frameId: string;
  frameNumber: number;
  puttsMade: number;
  pointsEarned: number;
}

export interface EventPlacementData {
  eventId: string;
  teamId: string;
  placement: number;
}

export interface CompletedProfileData {
  frameResults: FrameResultData[];
  placements: EventPlacementData[];
  matchRecordsByTeam: Map<string, { wins: number; losses: number }>;
}

export interface PlacementMatchData {
  id: number;
  eventId: string;
  groupNumber: number;
  roundNumber: number;
  opponent1: { id?: number; result?: string } | null;
  opponent2: { id?: number; result?: string } | null;
  opponent1TeamId: string | null;
  opponent2TeamId: string | null;
}

function sqlList(values: string[]) {
  return sql.join(values.map((value) => sql`${value}`), sql`, `);
}

/**
 * Load frames, completed/archived bracket matches, and stored placements in one
 * database round trip. Frame results join only through match_frames, deliberately
 * preserving historical rows whose bracket_match_id is null.
 */
export async function getCompletedProfileData(
  ex: Executor,
  eventPlayerIds: string[],
  eventIds: string[],
  teamIds: string[]
): Promise<CompletedProfileData> {
  if (eventPlayerIds.length === 0 || eventIds.length === 0) {
    return { frameResults: [], placements: [], matchRecordsByTeam: new Map() };
  }

  const eventPlayerList = sqlList(eventPlayerIds);
  const eventList = sqlList(eventIds);
  const rows = await ex.select({
    frameResults: sql<FrameResultData[]>`coalesce((
      select json_agg(json_build_object(
        'eventPlayerId', fr.event_player_id,
        'bracketMatchId', fr.bracket_match_id,
        'frameId', mf.id,
        'frameNumber', mf.frame_number,
        'puttsMade', fr.putts_made,
        'pointsEarned', fr.points_earned
      ))
      from ${frame_results} fr
      inner join ${match_frames} mf on mf.id = fr.match_frame_id
      where fr.event_player_id in (${eventPlayerList})
    ), '[]'::json)`,
    matches: sql<PlacementMatchData[]>`coalesce((
      select json_agg(json_build_object(
        'id', bm.id,
        'eventId', bm.event_id,
        'groupNumber', bg.number,
        'roundNumber', br.number,
        'opponent1', bm.opponent1,
        'opponent2', bm.opponent2,
        'opponent1TeamId', bp1.team_id,
        'opponent2TeamId', bp2.team_id
      ))
      from ${bracket_match} bm
      inner join ${bracket_round} br on br.id = bm.round_id
      inner join ${bracket_group} bg on bg.id = bm.group_id
      left join ${bracket_participant} bp1
        on bp1.id = nullif(bm.opponent1 ->> 'id', '')::integer
      left join ${bracket_participant} bp2
        on bp2.id = nullif(bm.opponent2 ->> 'id', '')::integer
      where bm.event_id in (${eventList}) and bm.status in (4, 5)
    ), '[]'::json)`,
    storedPlacements: sql<EventPlacementData[]>`coalesce((
      select json_agg(json_build_object(
        'eventId', ep.event_id,
        'teamId', ep.team_id,
        'placement', ep.placement
      ))
      from ${event_placements} ep
      where ep.event_id in (${eventList})
    ), '[]'::json)`,
  }).from(sql`(select 1) as profile_detail`);

  const detail = rows[0] ?? { frameResults: [], matches: [], storedPlacements: [] };
  return {
    frameResults: detail.frameResults,
    placements: placementsForEvents(eventIds, detail.matches, detail.storedPlacements),
    matchRecordsByTeam: calculateMatchRecords(detail.matches, teamIds),
  };
}

export function calculateEventPlacements(
  eventId: string,
  matches: PlacementMatchData[]
): EventPlacementData[] {
  const eventMatches = matches.filter((match) => match.eventId === eventId);
  if (eventMatches.length === 0) return [];

  const placements: EventPlacementData[] = [];
  const placedTeamIds = new Set<string>();
  const result = (match: PlacementMatchData): { winnerId?: string; loserId?: string } => {
    if (match.opponent1?.result === 'win') {
      return {
        winnerId: match.opponent1TeamId ?? undefined,
        loserId: match.opponent2TeamId ?? undefined,
      };
    }
    if (match.opponent2?.result === 'win') {
      return {
        winnerId: match.opponent2TeamId ?? undefined,
        loserId: match.opponent1TeamId ?? undefined,
      };
    }
    return {};
  };
  const add = (teamId: string | undefined) => {
    if (teamId && !placedTeamIds.has(teamId)) {
      placements.push({ eventId, teamId, placement: placements.length + 1 });
      placedTeamIds.add(teamId);
    }
  };

  for (const match of eventMatches
    .filter((item) => item.groupNumber === 3)
    .sort((a, b) => b.roundNumber - a.roundNumber || b.id - a.id)) {
    const { winnerId, loserId } = result(match);
    add(winnerId);
    add(loserId);
  }

  for (const groupNumber of [2, 1]) {
    const rounds = [...new Set(
      eventMatches.filter((item) => item.groupNumber === groupNumber).map((item) => item.roundNumber)
    )].sort((a, b) => b - a);
    for (const roundNumber of rounds) {
      for (const match of eventMatches.filter(
        (item) => item.groupNumber === groupNumber && item.roundNumber === roundNumber
      )) {
        add(result(match).loserId);
      }
    }
  }

  return placements;
}

function placementsForEvents(
  eventIds: string[],
  matches: PlacementMatchData[],
  stored: EventPlacementData[]
): EventPlacementData[] {
  const eventsWithStored = new Set(stored.map((placement) => placement.eventId));
  return [
    ...stored,
    ...eventIds
      .filter((eventId) => !eventsWithStored.has(eventId))
      .flatMap((eventId) => calculateEventPlacements(eventId, matches)),
  ];
}

function calculateMatchRecords(
  matches: PlacementMatchData[],
  teamIds: string[]
): Map<string, { wins: number; losses: number }> {
  const wanted = new Set(teamIds);
  const records = new Map<string, { wins: number; losses: number }>();

  for (const match of matches) {
    for (const [teamId, opponent] of [
      [match.opponent1TeamId, match.opponent1],
      [match.opponent2TeamId, match.opponent2],
    ] as const) {
      if (!teamId || !wanted.has(teamId)) continue;
      const key = `${match.eventId}:${teamId}`;
      const record = records.get(key) ?? { wins: 0, losses: 0 };
      if (opponent?.result === 'win') record.wins++;
      else if (opponent?.result === 'loss') record.losses++;
      records.set(key, record);
    }
  }

  return records;
}
