import 'server-only';
import { createClient } from '@/lib/supabase/server';
import type { PublicLeague, PublicLeagueDetail } from '@/lib/types/public';
import type { BracketWithTeams } from '@/lib/types/bracket';
import type { Team } from '@/lib/types/team';
import { NotFoundError } from '@/lib/errors';
import * as publicRepo from '@/lib/repositories/public-repository';

export async function getPublicLeagues(): Promise<PublicLeague[]> {
  const supabase = await createClient();
  return publicRepo.getAllLeagues(supabase);
}

export async function getPublicLeagueWithEvents(leagueId: string): Promise<PublicLeagueDetail> {
  const supabase = await createClient();
  const league = await publicRepo.getLeagueWithEvents(supabase, leagueId);

  if (!league) {
    throw new NotFoundError('League not found');
  }

  return league;
}

export async function getPublicBracket(eventId: string): Promise<BracketWithTeams> {
  const supabase = await createClient();

  // Get event to check it exists and get status
  const { data: event, error: eventError } = await supabase
    .from('events')
    .select('id, status')
    .eq('id', eventId)
    .single();

  if (eventError || !event) {
    throw new NotFoundError('Event not found');
  }

  // Only allow viewing bracket for events in bracket or completed status
  if (event.status !== 'bracket' && event.status !== 'completed') {
    throw new NotFoundError('Bracket not available for this event');
  }

  // Get bracket stage
  const { data: stage, error: stageError } = await supabase
    .from('bracket_stage')
    .select('*')
    .eq('tournament_id', eventId)
    .single();

  if (stageError || !stage) {
    throw new NotFoundError('Bracket not found for this event');
  }

  // Get bracket data
  const [groupsResult, roundsResult, matchesResult, participantsResult, teamsResult, lanesResult] = await Promise.all([
    supabase
      .from('bracket_group')
      .select('*')
      .eq('stage_id', stage.id)
      .order('number'),
    supabase
      .from('bracket_round')
      .select('*')
      .eq('stage_id', stage.id)
      .order('group_id')
      .order('number'),
    supabase
      .from('bracket_match')
      .select('*')
      .eq('stage_id', stage.id)
      .order('round_id')
      .order('number'),
    supabase
      .from('bracket_participant')
      .select('id, team_id')
      .eq('tournament_id', eventId),
    supabase
      .from('teams')
      .select(`
        id,
        event_id,
        seed,
        pool_combo,
        team_members (
          id,
          role,
          event_player:event_players (
            id,
            pool,
            pfa_score,
            player:players (
              id,
              player_number,
              first_name,
              last_name
            )
          )
        )
      `)
      .eq('event_id', eventId)
      .order('seed'),
    supabase
      .from('lanes')
      .select('id, event_id, label, status')
      .eq('event_id', eventId)
      .order('label'),
  ]);

  const results = [groupsResult, roundsResult, matchesResult, participantsResult, teamsResult, lanesResult];
  for (const result of results) {
    if (result.error) {
      console.error('Error fetching bracket data:', result.error);
      throw new NotFoundError('Bracket not found for this event');
    }
  }

  const groups = groupsResult.data || [];
  const rounds = roundsResult.data || [];
  const matches = matchesResult.data || [];
  const participants = participantsResult.data || [];
  const teams = (teamsResult.data || []) as unknown as Team[];
  const lanes = lanesResult.data || [];

  // Build participant to team mapping
  const participantTeamMap: Record<number, Team> = {};
  for (const p of participants) {
    const team = teams.find((t) => t.id === p.team_id);
    if (team) {
      participantTeamMap[p.id] = team;
    }
  }

  // Build lane ID to label mapping
  const laneMap: Record<string, string> = {};
  for (const lane of lanes) {
    laneMap[lane.id] = lane.label;
  }

  return {
    bracket: {
      stage: stage as unknown as BracketWithTeams['bracket']['stage'],
      groups: groups as unknown as BracketWithTeams['bracket']['groups'],
      rounds: rounds as unknown as BracketWithTeams['bracket']['rounds'],
      matches: matches as unknown as BracketWithTeams['bracket']['matches'],
      participants: participants as unknown as BracketWithTeams['bracket']['participants'],
    },
    teams,
    participantTeamMap,
    lanes: lanes as unknown as BracketWithTeams['lanes'],
    laneMap,
    eventStatus: event.status,
  };
}
