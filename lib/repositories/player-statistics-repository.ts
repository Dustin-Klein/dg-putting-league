import { createClient } from '@/lib/supabase/server';
import { InternalError } from '@/lib/errors';
import type { Player } from '@/lib/types/player';
import * as eventPlacementRepo from './event-placement-repository';

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Get player by player_number
 */
export async function getPlayerByNumber(
  supabase: SupabaseClient,
  playerNumber: number
): Promise<Player | null> {
  const { data: player, error } = await supabase
    .from('players')
    .select('*')
    .eq('player_number', playerNumber)
    .maybeSingle();

  if (error) {
    throw new InternalError(`Failed to fetch player: ${error.message}`);
  }

  return player as Player | null;
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

/**
 * Get all event participations for a player
 */
export async function getPlayerEventParticipations(
  supabase: SupabaseClient,
  playerId: string
): Promise<EventParticipation[]> {
  const { data, error } = await supabase
    .from('event_players')
    .select(`
      id,
      event_id,
      pool,
      event:events(
        id,
        event_date,
        league_id,
        location,
        status,
        league:leagues(
          id,
          name
        )
      )
    `)
    .eq('player_id', playerId)
    .order('created_at', { ascending: false });

  if (error) {
    throw new InternalError(`Failed to fetch event participations: ${error.message}`);
  }

  if (!data) return [];

  interface EventData {
    id: string;
    event_date: string;
    league_id: string;
    location: string | null;
    status: 'created' | 'pre-bracket' | 'bracket' | 'completed';
    league: { id: string; name: string } | null;
  }

  return data
    .filter((row) => row.event !== null)
    .map((row) => {
      const event = row.event as unknown as EventData;
      return {
        eventPlayerId: row.id,
        eventId: event.id,
        eventDate: event.event_date,
        pool: row.pool as 'A' | 'B' | null,
        leagueId: event.league_id,
        leagueName: event.league?.name || 'Unknown League',
        location: event.location,
        eventStatus: event.status,
      };
    });
}

export interface TeamInfo {
  eventPlayerId: string;
  teamId: string;
  seed: number;
  teammateEventPlayerId: string | null;
  teammatePlayerId: string | null;
  teammateName: string | null;
}

/**
 * Get team info for event players (including teammate)
 */
export async function getTeamInfoForEventPlayers(
  supabase: SupabaseClient,
  eventPlayerIds: string[]
): Promise<Map<string, TeamInfo>> {
  if (eventPlayerIds.length === 0) return new Map();

  const { data, error } = await supabase
    .from('team_members')
    .select(`
      event_player_id,
      team_id,
      team:teams(
        id,
        seed,
        team_members(
          event_player_id,
          event_player:event_players(
            id,
            player_id,
            player:players(
              id,
              full_name
            )
          )
        )
      )
    `)
    .in('event_player_id', eventPlayerIds);

  if (error) {
    throw new InternalError(`Failed to fetch team info: ${error.message}`);
  }

  const result = new Map<string, TeamInfo>();

  if (!data) return result;

  interface TeamData {
    id: string;
    seed: number;
    team_members: Array<{
      event_player_id: string;
      event_player: {
        id: string;
        player_id: string;
        player: { id: string; full_name: string } | null;
      } | null;
    }>;
  }

  for (const row of data) {
    const team = row.team as unknown as TeamData | null;

    if (!team) continue;

    const teammate = team.team_members.find(
      (tm) => tm.event_player_id !== row.event_player_id
    );

    result.set(row.event_player_id, {
      eventPlayerId: row.event_player_id,
      teamId: team.id,
      seed: team.seed,
      teammateEventPlayerId: teammate?.event_player_id || null,
      teammatePlayerId: teammate?.event_player?.player_id || null,
      teammateName: teammate?.event_player?.player?.full_name || null,
    });
  }

  return result;
}

export interface BracketMatchResult {
  teamId: string;
  eventId: string;
  bracketMatchId: number;
  result: 'win' | 'loss' | null;
}

/**
 * Get bracket match results for teams
 */
export async function getBracketMatchResultsForTeams(
  supabase: SupabaseClient,
  teamIds: string[],
  eventIds: string[]
): Promise<BracketMatchResult[]> {
  if (teamIds.length === 0 || eventIds.length === 0) return [];

  // Query participants filtered by both team_id AND tournament_id (event)
  // This ensures we get the correct participant IDs for each event
  const { data: participants, error: participantError } = await supabase
    .from('bracket_participant')
    .select('id, team_id, tournament_id')
    .in('team_id', teamIds)
    .in('tournament_id', eventIds);

  if (participantError) {
    throw new InternalError(`Failed to fetch bracket participants: ${participantError.message}`);
  }

  if (!participants || participants.length === 0) return [];

  // Map participant ID to {teamId, eventId}
  const participantInfo = new Map<number, { teamId: string; eventId: string }>();
  for (const p of participants) {
    if (p.team_id && p.tournament_id) {
      participantInfo.set(p.id, { teamId: p.team_id, eventId: p.tournament_id });
    }
  }

  const { data: matches, error: matchError } = await supabase
    .from('bracket_match')
    .select('id, event_id, opponent1, opponent2')
    .in('event_id', eventIds)
    .in('status', [4, 5]); // Completed (4) or Archived (5) matches

  if (matchError) {
    throw new InternalError(`Failed to fetch bracket matches: ${matchError.message}`);
  }

  if (!matches) return [];

  const results: BracketMatchResult[] = [];

  for (const match of matches) {
    const opp1 = match.opponent1 as { id?: number; result?: string } | null;
    const opp2 = match.opponent2 as { id?: number; result?: string } | null;
    const eventId = match.event_id as string;

    if (opp1?.id && participantInfo.has(opp1.id)) {
      const info = participantInfo.get(opp1.id)!;
      results.push({
        teamId: info.teamId,
        eventId,
        bracketMatchId: match.id,
        result: opp1.result === 'win' ? 'win' : opp1.result === 'loss' ? 'loss' : null,
      });
    }

    if (opp2?.id && participantInfo.has(opp2.id)) {
      const info = participantInfo.get(opp2.id)!;
      results.push({
        teamId: info.teamId,
        eventId,
        bracketMatchId: match.id,
        result: opp2.result === 'win' ? 'win' : opp2.result === 'loss' ? 'loss' : null,
      });
    }
  }

  return results;
}

/**
 * Get aggregated match wins and losses for teams per event.
 * Returns a map keyed by "eventId:teamId" to track records separately per event.
 */
export async function getMatchRecordsForTeams(
  supabase: SupabaseClient,
  teamIds: string[],
  eventIds: string[]
): Promise<Map<string, { wins: number; losses: number }>> {
  const bracketResults = await getBracketMatchResultsForTeams(supabase, teamIds, eventIds);

  // Key by eventId:teamId to get per-event records
  const resultsByEventTeam = new Map<string, { wins: number; losses: number }>();
  for (const result of bracketResults) {
    const key = `${result.eventId}:${result.teamId}`;
    if (!resultsByEventTeam.has(key)) {
      resultsByEventTeam.set(key, { wins: 0, losses: 0 });
    }
    const record = resultsByEventTeam.get(key)!;
    if (result.result === 'win') {
      record.wins++;
    } else if (result.result === 'loss') {
      record.losses++;
    }
  }

  return resultsByEventTeam;
}

export interface FrameResultData {
  eventPlayerId: string;
  bracketMatchId: number;
  frameId: string;
  frameNumber: number;
  puttsMade: number;
  pointsEarned: number;
}

/**
 * Get frame results for event players
 */
export async function getPlayerFrameResultsWithDetails(
  supabase: SupabaseClient,
  eventPlayerIds: string[]
): Promise<FrameResultData[]> {
  if (eventPlayerIds.length === 0) return [];

  const { data, error } = await supabase
    .from('frame_results')
    .select(`
      id,
      event_player_id,
      bracket_match_id,
      putts_made,
      points_earned,
      match_frame:match_frames(
        id,
        frame_number
      )
    `)
    .in('event_player_id', eventPlayerIds);

  if (error) {
    throw new InternalError(`Failed to fetch frame results: ${error.message}`);
  }

  if (!data) return [];

  interface MatchFrameData {
    id: string;
    frame_number: number;
  }

  return data
    .filter((row) => row.bracket_match_id !== null && row.match_frame !== null)
    .map((row) => {
      const matchFrame = row.match_frame as unknown as MatchFrameData;
      return {
        eventPlayerId: row.event_player_id,
        bracketMatchId: row.bracket_match_id as number,
        frameId: matchFrame.id,
        frameNumber: matchFrame.frame_number,
        puttsMade: row.putts_made,
        pointsEarned: row.points_earned,
      };
    });
}

export interface EventPlacementData {
  eventId: string;
  teamId: string;
  placement: number;
}

/**
 * Get placements for events (uses stored placements with fallback to calculation)
 */
export async function getPlacementsForEvents(
  supabase: SupabaseClient,
  eventIds: string[]
): Promise<EventPlacementData[]> {
  if (eventIds.length === 0) return [];

  const storedPlacements = await eventPlacementRepo.getStoredPlacementsForEvents(supabase, eventIds);
  const eventsWithStoredPlacements = new Set(storedPlacements.map((p) => p.eventId));

  const eventsNeedingCalculation = eventIds.filter((id) => !eventsWithStoredPlacements.has(id));

  const results = await Promise.all(
    eventsNeedingCalculation.map((eventId) => calculateEventPlacements(supabase, eventId))
  );
  const calculatedPlacements = results.flat();

  return [...storedPlacements, ...calculatedPlacements];
}

export async function calculateEventPlacements(
  supabase: SupabaseClient,
  eventId: string
): Promise<EventPlacementData[]> {
  const { data: stage, error: stageError } = await supabase
    .from('bracket_stage')
    .select('id')
    .eq('tournament_id', eventId)
    .maybeSingle();

  if (stageError || !stage) return [];

  const { data: groups } = await supabase
    .from('bracket_group')
    .select('id, number')
    .eq('stage_id', stage.id);

  if (!groups) return [];

  const { data: rounds } = await supabase
    .from('bracket_round')
    .select('id, number, group_id')
    .in('group_id', groups.map(g => g.id));

  if (!rounds) return [];

  const { data: matches } = await supabase
    .from('bracket_match')
    .select('id, round_id, opponent1, opponent2, status')
    .eq('event_id', eventId)
    .in('status', [4, 5]);

  if (!matches || matches.length === 0) return [];

  const { data: participants } = await supabase
    .from('bracket_participant')
    .select('id, team_id')
    .eq('tournament_id', eventId);

  if (!participants) return [];

  const participantTeamMap = new Map<number, string>();
  for (const p of participants) {
    if (p.team_id) {
      participantTeamMap.set(p.id, p.team_id);
    }
  }

  const placements: EventPlacementData[] = [];
  const placedTeamIds = new Set<string>();

  const getTeamId = (participantId: number | null): string | undefined => {
    if (participantId === null) return undefined;
    return participantTeamMap.get(participantId);
  };

  const getMatchResult = (match: typeof matches[0]): { winnerId?: string; loserId?: string } => {
    const opp1 = match.opponent1 as { id?: number; result?: string } | null;
    const opp2 = match.opponent2 as { id?: number; result?: string } | null;

    if (opp1?.result === 'win') {
      return {
        winnerId: getTeamId(opp1.id ?? null),
        loserId: getTeamId(opp2?.id ?? null),
      };
    } else if (opp2?.result === 'win') {
      return {
        winnerId: getTeamId(opp2.id ?? null),
        loserId: getTeamId(opp1?.id ?? null),
      };
    }
    return {};
  };

  const grandFinalGroup = groups.find(g => g.number === 3);
  const losersGroup = groups.find(g => g.number === 2);
  const winnersGroup = groups.find(g => g.number === 1);

  // Grand Final placements
  if (grandFinalGroup) {
    const gfRounds = rounds
      .filter(r => r.group_id === grandFinalGroup.id)
      .sort((a, b) => b.number - a.number);

    for (const round of gfRounds) {
      const roundMatches = matches
        .filter(m => m.round_id === round.id)
        .sort((a, b) => b.id - a.id);

      for (const match of roundMatches) {
        const { winnerId, loserId } = getMatchResult(match);

        if (winnerId && !placedTeamIds.has(winnerId)) {
          placements.push({ eventId, teamId: winnerId, placement: placements.length + 1 });
          placedTeamIds.add(winnerId);
        }

        if (loserId && !placedTeamIds.has(loserId)) {
          placements.push({ eventId, teamId: loserId, placement: placements.length + 1 });
          placedTeamIds.add(loserId);
        }
      }
    }
  }

  // Loser's bracket placements
  if (losersGroup) {
    const lbRounds = rounds
      .filter(r => r.group_id === losersGroup.id)
      .sort((a, b) => b.number - a.number);

    for (const round of lbRounds) {
      const roundMatches = matches.filter(m => m.round_id === round.id);
      const losersThisRound: string[] = [];

      for (const match of roundMatches) {
        const { loserId } = getMatchResult(match);
        if (loserId && !placedTeamIds.has(loserId)) {
          losersThisRound.push(loserId);
          placedTeamIds.add(loserId);
        }
      }

      for (const teamId of losersThisRound) {
        placements.push({ eventId, teamId, placement: placements.length + 1 });
      }
    }
  }

  // Winner's bracket placements (remaining)
  if (winnersGroup) {
    const wbRounds = rounds
      .filter(r => r.group_id === winnersGroup.id)
      .sort((a, b) => b.number - a.number);

    for (const round of wbRounds) {
      const roundMatches = matches.filter(m => m.round_id === round.id);
      const losersThisRound: string[] = [];

      for (const match of roundMatches) {
        const { loserId } = getMatchResult(match);
        if (loserId && !placedTeamIds.has(loserId)) {
          losersThisRound.push(loserId);
          placedTeamIds.add(loserId);
        }
      }

      for (const teamId of losersThisRound) {
        placements.push({ eventId, teamId, placement: placements.length + 1 });
      }
    }
  }

  return placements;
}
