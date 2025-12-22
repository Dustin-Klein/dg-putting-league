import 'server-only';
import {
  NotFoundError,
  BadRequestError,
  InternalError,
} from '@/lib/errors';
import { requireEventAdmin, getEventWithPlayers } from './event';
import { createClient } from '@/lib/supabase/server';
import { EventWithDetails, EventPlayer } from '@/app/event/[eventId]/types';

export interface Team {
  id: string;
  event_id: string;
  seed: number;
  pool_combo: string;
  created_at: string;
  team_members: TeamMember[];
}

export interface TeamMember {
  team_id: string;
  event_player_id: string;
  role: 'A_pool' | 'B_pool' | 'alternate';
  joined_at: string;
  event_player: EventPlayer;
}

/**
 * Generate teams of 2 players (1 from Pool A, 1 from Pool B) when event status changes to 'bracket'
 */
export async function generateTeams(eventId: string): Promise<Team[]> {
  const { supabase } = await requireEventAdmin(eventId);
  const event = await getEventWithPlayers(eventId);

  // Allow team generation for events transitioning to bracket status (pre-bracket)
  // or already in bracket status
  if (event.status !== 'pre-bracket' && event.status !== 'bracket') {
    throw new BadRequestError('Teams can only be generated for events in pre-bracket or bracket status');
  }

  // Check if teams already exist
  const { data: existingTeams, error: checkError } = await supabase
    .from('teams')
    .select('id')
    .eq('event_id', eventId);

  if (checkError) throw new InternalError(checkError.message);
  if (existingTeams && existingTeams.length > 0) {
    throw new BadRequestError('Teams have already been generated for this event');
  }

  // Get players with their pools and qualification scores
  const playersWithPools = event.players.filter(player => player.pool);
  if (playersWithPools.length === 0) {
    throw new BadRequestError('No players have been assigned to pools');
  }

  // Separate players by pool
  const poolAPlayers = playersWithPools.filter(player => player.pool === 'A');
  const poolBPlayers = playersWithPools.filter(player => player.pool === 'B');

  if (poolAPlayers.length === 0 || poolBPlayers.length === 0) {
    throw new BadRequestError('Both Pool A and Pool B must have players to generate teams');
  }

  // Calculate qualification scores for seeding
  const playersWithScores = await Promise.all(
    playersWithPools.map(async (player) => {
      let score: number;

      if (event.qualification_round_enabled) {
        // Calculate total qualification score
        const { data: qualificationFrames, error: qualError } = await supabase
          .from('qualification_frames')
          .select('points_earned')
          .eq('event_id', eventId)
          .eq('event_player_id', player.id);

        if (qualError) {
          throw new InternalError(`Failed to fetch qualification frames for player ${player.id}: ${qualError.message}`);
        }

        score = qualificationFrames?.reduce((sum, frame) => sum + frame.points_earned, 0) || 0;
      } else {
        // For events without qualification, use 0 as base score (seeding will be random within pools)
        score = 0;
      }

      return {
        ...player,
        qualificationScore: score
      };
    })
  );

  // Sort each pool by qualification score (descending) for seeding
  poolAPlayers.sort((a, b) => {
    const aScore = playersWithScores.find(p => p.id === a.id)?.qualificationScore || 0;
    const bScore = playersWithScores.find(p => p.id === b.id)?.qualificationScore || 0;
    return bScore - aScore;
  });

  poolBPlayers.sort((a, b) => {
    const aScore = playersWithScores.find(p => p.id === a.id)?.qualificationScore || 0;
    const bScore = playersWithScores.find(p => p.id === b.id)?.qualificationScore || 0;
    return bScore - aScore;
  });

  // Generate teams by pairing top Pool A player with top Pool B player, second with second, etc.
  const teamsToCreate = [];
  const teamMembersToCreate = [];
  const minPoolSize = Math.min(poolAPlayers.length, poolBPlayers.length);

  for (let i = 0; i < minPoolSize; i++) {
    const poolAPlayer = poolAPlayers[i];
    const poolBPlayer = poolBPlayers[i];
    
    // Calculate combined score for seeding
    const poolAScore = playersWithScores.find(p => p.id === poolAPlayer.id)?.qualificationScore || 0;
    const poolBScore = playersWithScores.find(p => p.id === poolBPlayer.id)?.qualificationScore || 0;
    const combinedScore = poolAScore + poolBScore;

    teamsToCreate.push({
      event_id: eventId,
      seed: i + 1, // Will be recalculated after sorting by combined score
      pool_combo: `${poolAPlayer.player.full_name} & ${poolBPlayer.player.full_name}`
    });

    // Store team members for later insertion
    teamMembersToCreate.push({
      team_index: i, // Temporary index to link with team
      event_player_id: poolAPlayer.id,
      role: 'A_pool' as const
    });

    teamMembersToCreate.push({
      team_index: i, // Temporary index to link with team
      event_player_id: poolBPlayer.id,
      role: 'B_pool' as const
    });
  }

  // Debug logging
  const teamData = teamsToCreate.map(team => ({
    event_id: team.event_id,
    seed: team.seed,
    pool_combo: team.pool_combo
  }));
  
  const memberData = teamMembersToCreate.map(member => ({
    team_index: member.team_index,
    event_player_id: member.event_player_id,
    role: member.role
  }));

  console.log('Sending to generate_teams_for_event:', JSON.stringify({
    p_event_id: eventId,
    p_team_data: teamData,
    p_team_members_data: memberData
  }, null, 2));

  try {
    // Create teams and team members using security definer function
    const { data: rpcResult, error: createError } = await supabase.rpc('generate_teams_for_event', {
      p_event_id: eventId,
      p_team_data: teamData,
      p_team_members_data: memberData
    });

    if (createError) {
      console.error('RPC Error:', createError);
      throw new InternalError(`Failed to create teams: ${createError.message}`);
    }

    if (!rpcResult || !rpcResult.success) {
      console.error('RPC Result indicates failure:', rpcResult);
      throw new InternalError('Failed to create teams: RPC call did not succeed');
    }
  } catch (error) {
    console.error('Error in RPC call:', error);
    throw new InternalError(`Failed to create teams: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }

  // Fetch the created teams to get their actual IDs
  const { data: createdTeams, error: teamsFetchError } = await supabase
    .from('teams')
    .select('*')
    .eq('event_id', eventId)
    .order('created_at', { ascending: true });

  if (teamsFetchError || !createdTeams) {
    throw new InternalError(`Failed to fetch created teams: ${teamsFetchError?.message}`);
  }

  // Sort teams by combined qualification score and update seeds
  const teamsWithScores = createdTeams.map((team, index) => {
    const poolAPlayer = poolAPlayers[index];
    const poolBPlayer = poolBPlayers[index];
    const poolAScore = playersWithScores.find(p => p.id === poolAPlayer.id)?.qualificationScore || 0;
    const poolBScore = playersWithScores.find(p => p.id === poolBPlayer.id)?.qualificationScore || 0;
    
    return {
      ...team,
      combinedScore: poolAScore + poolBScore
    };
  });

  teamsWithScores.sort((a, b) => b.combinedScore - a.combinedScore);

  // Update team seeds based on combined scores using security definer function
  const seedUpdates = teamsWithScores.map((team, index) => ({
    id: team.id,
    seed: index + 1
  }));

  const { error: seedError } = await supabase.rpc('update_team_seeds', {
    p_event_id: eventId,
    p_seed_updates: seedUpdates
  });

  if (seedError) {
    throw new InternalError(`Failed to update team seeds: ${seedError.message}`);
  }

  // Fetch complete teams with members for return
  const { data: finalTeams, error: fetchError } = await supabase
    .from('teams')
    .select(`
      *,
      team_members(
        *,
        event_player:event_players(
          *,
          player:players(*)
        )
      )
    `)
    .eq('event_id', eventId)
    .order('seed');

  if (fetchError || !finalTeams) {
    throw new InternalError('Failed to fetch generated teams');
  }

  return finalTeams as unknown as Team[];
}

/**
 * Get teams for an event
 */
export async function getEventTeams(eventId: string): Promise<Team[]> {
  const { supabase } = await requireEventAdmin(eventId);

  const { data: teams, error } = await supabase
    .from('teams')
    .select(`
      *,
      team_members(
        *,
        event_player:event_players(
          *,
          player:players(*)
        )
      )
    `)
    .eq('event_id', eventId)
    .order('seed');

  if (error) throw new InternalError(error.message);
  if (!teams) return [];

  return teams as unknown as Team[];
}
