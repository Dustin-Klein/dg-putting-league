import 'server-only';
import { BracketsManager } from 'brackets-manager';
import type { Match, Participant, Stage, Group, Round } from 'brackets-model';
import { Status } from 'brackets-model';
import { createClient } from '@/lib/supabase/server';
import { SupabaseBracketStorage } from '@/lib/repositories/bracket-repository';
import { requireEventAdmin, getEventWithPlayers } from '@/lib/services/event';
import { getEventTeams, Team } from '@/lib/services/team';
import {
  BadRequestError,
  InternalError,
  NotFoundError,
} from '@/lib/errors';

/**
 * Get the next power of 2 that is >= n
 */
function nextPowerOf2(n: number): number {
  if (n <= 1) return 2;
  let power = 1;
  while (power < n) {
    power *= 2;
  }
  return power;
}

export interface BracketData {
  stage: Stage;
  groups: Group[];
  rounds: Round[];
  matches: Match[];
  participants: Participant[];
}

export interface MatchWithTeams extends Match {
  team1?: Team;
  team2?: Team;
}

/**
 * Create a double elimination bracket for an event
 * @param eventId - The event ID
 * @param allowPreBracketStatus - If true, allows creation when status is 'pre-bracket' (for transactional status changes)
 */
export async function createBracket(eventId: string, allowPreBracketStatus = false): Promise<BracketData> {
  const { supabase } = await requireEventAdmin(eventId);
  const event = await getEventWithPlayers(eventId);

  const validStatuses = allowPreBracketStatus ? ['bracket', 'pre-bracket'] : ['bracket'];
  if (!validStatuses.includes(event.status)) {
    throw new BadRequestError('Bracket can only be created for events in bracket status');
  }

  // Check if bracket already exists
  const { data: existingStage } = await supabase
    .from('bracket_stage')
    .select('id')
    .eq('tournament_id', eventId)
    .maybeSingle();

  if (existingStage) {
    throw new BadRequestError('Bracket has already been created for this event');
  }

  // Get teams for seeding
  const teams = await getEventTeams(eventId);

  if (teams.length < 2) {
    throw new BadRequestError('At least 2 teams are required to create a bracket');
  }

  // Create storage adapter and manager
  const storage = new SupabaseBracketStorage(supabase, eventId);
  const manager = new BracketsManager(storage);

  // Create participants from teams (sorted by seed)
  const sortedTeams = [...teams].sort((a, b) => (a.seed || 0) - (b.seed || 0));

  // brackets-manager requires participant count to be a power of 2
  // Add BYEs (null) to fill up to the next power of 2
  const bracketSize = nextPowerOf2(sortedTeams.length);
  const seeding: (string | null)[] = sortedTeams.map((team) => team.pool_combo);

  // Add BYEs to fill the bracket
  while (seeding.length < bracketSize) {
    seeding.push(null);
  }

  // Create the double elimination stage
  await manager.create.stage({
    tournamentId: eventId as unknown as number,
    name: 'Double Elimination',
    type: 'double_elimination',
    seeding,
    settings: {
      grandFinal: 'double', // WB winner must lose twice
      seedOrdering: ['natural'], // Use seeds as-is
      balanceByes: true, // Distribute BYEs evenly
    },
  });

  // Link participants to teams
  const { data: participants } = await supabase
    .from('bracket_participant')
    .select('*')
    .eq('tournament_id', eventId)
    .order('id');

  if (participants) {
    for (let i = 0; i < participants.length; i++) {
      const team = sortedTeams[i];
      if (team) {
        await supabase
          .from('bracket_participant')
          .update({ team_id: team.id })
          .eq('id', participants[i].id);
      }
    }
  }

  // Add event_id to all matches for easier querying
  const { data: stage } = await supabase
    .from('bracket_stage')
    .select('id')
    .eq('tournament_id', eventId)
    .single();

  if (stage) {
    await supabase
      .from('bracket_match')
      .update({ event_id: eventId })
      .eq('stage_id', stage.id);
  }

  // Set initial matches to ready status if they have both opponents
  await setInitialMatchesReady(supabase, eventId);

  // Return the created bracket data
  return getBracket(eventId);
}

/**
 * Set initial matches (first round) to ready status
 */
async function setInitialMatchesReady(
  supabase: Awaited<ReturnType<typeof createClient>>,
  eventId: string
): Promise<void> {
  const { data: stage } = await supabase
    .from('bracket_stage')
    .select('id')
    .eq('tournament_id', eventId)
    .single();

  if (!stage) return;

  // Get first round matches that have both opponents
  const { data: matches } = await supabase
    .from('bracket_match')
    .select('*')
    .eq('stage_id', stage.id)
    .not('opponent1', 'is', null)
    .not('opponent2', 'is', null);

  if (!matches) return;

  // Update matches where both opponents have IDs (not BYEs)
  for (const match of matches) {
    const opp1 = match.opponent1 as { id: number | null } | null;
    const opp2 = match.opponent2 as { id: number | null } | null;

    if (opp1?.id !== null && opp2?.id !== null) {
      await supabase
        .from('bracket_match')
        .update({ status: Status.Ready })
        .eq('id', match.id);
    }
  }
}

/**
 * Get the bracket data for an event
 */
export async function getBracket(eventId: string): Promise<BracketData> {
  const { supabase } = await requireEventAdmin(eventId);

  // Get stage
  const { data: stage, error: stageError } = await supabase
    .from('bracket_stage')
    .select('*')
    .eq('tournament_id', eventId)
    .single();

  if (stageError || !stage) {
    throw new NotFoundError('Bracket not found for this event');
  }

  // Get groups
  const { data: groups } = await supabase
    .from('bracket_group')
    .select('*')
    .eq('stage_id', stage.id)
    .order('number');

  // Get rounds
  const { data: rounds } = await supabase
    .from('bracket_round')
    .select('*')
    .eq('stage_id', stage.id)
    .order('group_id')
    .order('number');

  // Get matches
  const { data: matches } = await supabase
    .from('bracket_match')
    .select('*')
    .eq('stage_id', stage.id)
    .order('round_id')
    .order('number');

  // Get participants
  const { data: participants } = await supabase
    .from('bracket_participant')
    .select('*')
    .eq('tournament_id', eventId)
    .order('id');

  return {
    stage: stage as unknown as Stage,
    groups: (groups || []) as unknown as Group[],
    rounds: (rounds || []) as unknown as Round[],
    matches: (matches || []) as unknown as Match[],
    participants: (participants || []) as unknown as Participant[],
  };
}

/**
 * Get bracket data with team information included
 */
export async function getBracketWithTeams(eventId: string): Promise<{
  bracket: BracketData;
  teams: Team[];
  participantTeamMap: Record<number, Team>;
}> {
  const bracket = await getBracket(eventId);
  const teams = await getEventTeams(eventId);

  const { supabase } = await requireEventAdmin(eventId);

  // Get participant-team mappings
  const { data: participantsWithTeams } = await supabase
    .from('bracket_participant')
    .select('id, team_id')
    .eq('tournament_id', eventId);

  const participantTeamMap: Record<number, Team> = {};

  if (participantsWithTeams) {
    for (const p of participantsWithTeams) {
      const team = teams.find((t) => t.id === p.team_id);
      if (team) {
        participantTeamMap[p.id] = team;
      }
    }
  }

  return { bracket, teams, participantTeamMap };
}

/**
 * Update match score/result
 */
export async function updateMatchResult(
  eventId: string,
  matchId: number,
  opponent1Score: number,
  opponent2Score: number,
  winnerId?: number | null
): Promise<Match> {
  const { supabase } = await requireEventAdmin(eventId);

  // Verify match belongs to this event
  const { data: match, error: matchError } = await supabase
    .from('bracket_match')
    .select('*, bracket_stage!inner(tournament_id)')
    .eq('id', matchId)
    .single();

  if (matchError || !match) {
    throw new NotFoundError('Match not found');
  }

  if ((match.bracket_stage as { tournament_id: string }).tournament_id !== eventId) {
    throw new BadRequestError('Match does not belong to this event');
  }

  // Create storage adapter and manager
  const storage = new SupabaseBracketStorage(supabase, eventId);
  const manager = new BracketsManager(storage);

  // Determine winner based on scores if not provided
  let result1: 'win' | 'loss' | 'draw' | undefined;
  let result2: 'win' | 'loss' | 'draw' | undefined;

  if (winnerId !== undefined) {
    const opp1 = match.opponent1 as { id: number | null } | null;
    const opp2 = match.opponent2 as { id: number | null } | null;

    if (winnerId === null) {
      // Draw
      result1 = 'draw';
      result2 = 'draw';
    } else if (winnerId === opp1?.id) {
      result1 = 'win';
      result2 = 'loss';
    } else if (winnerId === opp2?.id) {
      result1 = 'loss';
      result2 = 'win';
    }
  } else if (opponent1Score !== opponent2Score) {
    // Determine winner by score
    if (opponent1Score > opponent2Score) {
      result1 = 'win';
      result2 = 'loss';
    } else {
      result1 = 'loss';
      result2 = 'win';
    }
  }

  // Update match using brackets-manager
  await manager.update.match({
    id: matchId,
    opponent1: { score: opponent1Score, result: result1 },
    opponent2: { score: opponent2Score, result: result2 },
  });

  // Fetch and return updated match
  const { data: updatedMatch, error: updateError } = await supabase
    .from('bracket_match')
    .select('*')
    .eq('id', matchId)
    .single();

  if (updateError || !updatedMatch) {
    throw new InternalError('Failed to fetch updated match');
  }

  return updatedMatch as unknown as Match;
}

/**
 * Get matches that are ready to be played
 */
export async function getReadyMatches(eventId: string): Promise<Match[]> {
  const { supabase } = await requireEventAdmin(eventId);

  const { data: stage } = await supabase
    .from('bracket_stage')
    .select('id')
    .eq('tournament_id', eventId)
    .single();

  if (!stage) {
    throw new NotFoundError('Bracket not found');
  }

  const { data: matches } = await supabase
    .from('bracket_match')
    .select('*')
    .eq('stage_id', stage.id)
    .eq('status', Status.Ready)
    .order('round_id')
    .order('number');

  return (matches || []) as unknown as Match[];
}

/**
 * Assign a lane to a match using atomic RPC
 */
export async function assignLaneToMatch(
  eventId: string,
  matchId: number,
  laneId: string
): Promise<void> {
  const { supabase } = await requireEventAdmin(eventId);

  // Use atomic RPC for lane assignment
  const { data: assigned, error } = await supabase
    .rpc('assign_lane_to_match', {
      p_event_id: eventId,
      p_lane_id: laneId,
      p_match_id: matchId,
    });

  if (error) {
    throw new InternalError(`Failed to assign lane to match: ${error.message}`);
  }

  if (!assigned) {
    throw new BadRequestError('Lane is not available for assignment');
  }
}

/**
 * Check if bracket exists for an event
 */
export async function bracketExists(eventId: string): Promise<boolean> {
  const supabase = await createClient();

  const { data } = await supabase
    .from('bracket_stage')
    .select('id')
    .eq('tournament_id', eventId)
    .maybeSingle();

  return !!data;
}

export { Status } from 'brackets-model';
