import { createClient } from '@/lib/supabase/server';
import { InternalError } from '@/lib/errors';
import type { Team } from '@/lib/types/team';

export interface TeamData {
  id: string;
  seed: number;
  pool_combo: string;
}

export interface TeamMemberData {
  event_player_id: string;
  role: 'A_pool' | 'B_pool';
}

export interface TeamWithPlayers extends TeamData {
  players: TeamPlayerInfo[];
}

export interface TeamPlayerInfo extends TeamMemberData {
  player: {
    id: string;
    full_name: string;
    nickname: string | null;
  };
}

export interface PublicTeamPlayerInfo extends TeamMemberData {
  full_name: string;
  nickname: string | null;
}

export interface PublicTeamWithPlayers extends TeamData {
  players: PublicTeamPlayerInfo[];
}

// Types for Supabase query results with nested structure
interface TeamQueryTeamMember {
  event_player_id: string;
  role: 'A_pool' | 'B_pool';
  event_player: {
    id: string;
    player: {
      id: string;
      full_name: string;
      nickname: string | null;
    };
  } | null;
}

interface TeamQueryResult {
  id: string;
  seed: number;
  pool_combo: string;
  team_members: TeamQueryTeamMember[];
}

interface ParticipantWithTeam {
  team_id: string | null;
  team: TeamQueryResult | null;
}

interface PublicTeamQueryTeamMember {
  event_player_id: string;
  role: 'A_pool' | 'B_pool';
  event_player: {
    player: {
      full_name: string;
      nickname: string | null;
    } | null;
  } | null;
}

interface PublicTeamQueryResult {
  id: string;
  seed: number;
  pool_combo: string;
  team_members: PublicTeamQueryTeamMember[];
}

interface PublicParticipantWithTeam {
  team_id: string | null;
  team: PublicTeamQueryResult | null;
}

/**
 * Get team info from a bracket participant ID
 * Returns full player info including player ID (for admin use)
 * Optimized: Single query using join on bracket_participant
 */
export async function getTeamFromParticipant(
  supabase: Awaited<ReturnType<typeof createClient>>,
  participantId: number | null
): Promise<TeamWithPlayers | null> {
  if (!participantId) return null;

  // Single query: join bracket_participant -> teams -> team_members -> event_players -> players
  const { data: participant } = await supabase
    .from('bracket_participant')
    .select(`
      team_id,
      team:teams(
        id,
        seed,
        pool_combo,
        team_members(
          event_player_id,
          role,
          event_player:event_players(
            id,
            player:players(
              id,
              full_name,
              nickname
            )
          )
        )
      )
    `)
    .eq('id', participantId)
    .single();

  const typedParticipant = participant as ParticipantWithTeam | null;
  const team = typedParticipant?.team;
  if (!team) return null;

  return {
    id: team.id,
    seed: team.seed,
    pool_combo: team.pool_combo,
    players: team.team_members
      ?.filter((tm) => tm.event_player?.player)
      .map((tm) => ({
        event_player_id: tm.event_player_id,
        role: tm.role,
        player: tm.event_player!.player,
      })) || [],
  };
}

/**
 * Get team info from a bracket participant ID
 * Returns limited player info (for public use - no player ID)
 * Optimized: Single query using join on bracket_participant
 */
export async function getPublicTeamFromParticipant(
  supabase: Awaited<ReturnType<typeof createClient>>,
  participantId: number | null
): Promise<PublicTeamWithPlayers | null> {
  if (!participantId) return null;

  // Single query: join bracket_participant -> teams -> team_members -> event_players -> players
  const { data: participant } = await supabase
    .from('bracket_participant')
    .select(`
      team_id,
      team:teams(
        id,
        seed,
        pool_combo,
        team_members(
          event_player_id,
          role,
          event_player:event_players(
            player:players(full_name, nickname)
          )
        )
      )
    `)
    .eq('id', participantId)
    .single();

  const typedParticipant = participant as PublicParticipantWithTeam | null;
  const team = typedParticipant?.team;
  if (!team) return null;

  return {
    id: team.id,
    seed: team.seed,
    pool_combo: team.pool_combo,
    players: team.team_members?.map((tm) => ({
      event_player_id: tm.event_player_id,
      role: tm.role,
      full_name: tm.event_player?.player?.full_name || 'Unknown',
      nickname: tm.event_player?.player?.nickname ?? null,
    })) || [],
  };
}

/**
 * Verify a player is a member of one of the given teams
 */
export async function verifyPlayerInTeams(
  supabase: Awaited<ReturnType<typeof createClient>>,
  eventPlayerId: string,
  teamIds: string[]
): Promise<boolean> {
  if (teamIds.length === 0) return false;

  const { data: teamMember, error } = await supabase
    .from('team_members')
    .select('team_id')
    .in('team_id', teamIds)
    .eq('event_player_id', eventPlayerId)
    .maybeSingle();

  if (error) {
    throw new InternalError(`Failed to verify team membership: ${error.message}`);
  }

  return !!teamMember;
}

/**
 * Verify multiple players are members of the given teams (batch operation)
 * Returns true if ALL unique players in the list are found in the teams
 */
export async function verifyPlayersInTeams(
  supabase: Awaited<ReturnType<typeof createClient>>,
  eventPlayerIds: string[],
  teamIds: string[]
): Promise<boolean> {
  if (teamIds.length === 0 || eventPlayerIds.length === 0) return false;

  const uniquePlayerIds = [...new Set(eventPlayerIds)];

  const { data, error } = await supabase
    .from('team_members')
    .select('event_player_id')
    .in('team_id', teamIds)
    .in('event_player_id', uniquePlayerIds);

  if (error) {
    throw new InternalError(`Failed to verify players in teams: ${error.message}`);
  }

  const foundPlayerIds = new Set(data?.map(d => d.event_player_id));
  return uniquePlayerIds.every(id => foundPlayerIds.has(id));
}

/**
 * Get team IDs from bracket participant IDs
 */
export async function getTeamIdsFromParticipants(
  supabase: Awaited<ReturnType<typeof createClient>>,
  participantIds: number[]
): Promise<string[]> {
  if (participantIds.length === 0) return [];

  const { data: participants } = await supabase
    .from('bracket_participant')
    .select('team_id')
    .in('id', participantIds);

  return participants?.map(p => p.team_id).filter((id): id is string => id !== null) || [];
}

/**
 * Check if teams exist for an event
 */
export async function getTeamsForEvent(
  supabase: Awaited<ReturnType<typeof createClient>>,
  eventId: string
): Promise<{ id: string }[]> {
  const { data: existingTeams, error } = await supabase
    .from('teams')
    .select('id')
    .eq('event_id', eventId);

  if (error) {
    throw new Error(error.message);
  }

  return existingTeams || [];
}

/**
 * Insert a new team
 */
export async function insertTeam(
  supabase: Awaited<ReturnType<typeof createClient>>,
  eventId: string,
  seed: number,
  poolCombo: string
): Promise<string> {
  const { data: newTeam, error } = await supabase
    .from('teams')
    .insert({
      event_id: eventId,
      seed,
      pool_combo: poolCombo
    })
    .select('id')
    .single();

  if (error || !newTeam) {
    throw new Error(`Failed to create team: ${error?.message}`);
  }

  return newTeam.id;
}

/**
 * Insert a team member
 */
export async function insertTeamMember(
  supabase: Awaited<ReturnType<typeof createClient>>,
  teamId: string,
  eventPlayerId: string,
  role: 'A_pool' | 'B_pool'
): Promise<void> {
  const { error } = await supabase
    .from('team_members')
    .insert({
      team_id: teamId,
      event_player_id: eventPlayerId,
      role
    });

  if (error) {
    throw new Error(`Failed to create team member: ${error.message}`);
  }
}

/**
 * Get teams with members for seed calculation
 */
export async function getTeamsWithMembersForEvent(
  supabase: Awaited<ReturnType<typeof createClient>>,
  eventId: string
): Promise<{ id: string; team_members: { event_player_id: string }[] }[]> {
  const { data: teamsWithMembers, error } = await supabase
    .from('teams')
    .select(`*, team_members(*)`)
    .eq('event_id', eventId);

  if (error) {
    throw new Error(`Failed to fetch teams with members: ${error.message}`);
  }

  return teamsWithMembers || [];
}

/**
 * Update team seed
 */
export async function updateTeamSeed(
  supabase: Awaited<ReturnType<typeof createClient>>,
  teamId: string,
  seed: number
): Promise<void> {
  const { error } = await supabase
    .from('teams')
    .update({ seed })
    .eq('id', teamId);

  if (error) {
    throw new Error(`Failed to update team seed: ${error.message}`);
  }
}

/**
 * Get full team details for an event
 */
export async function getFullTeamsForEvent(
  supabase: Awaited<ReturnType<typeof createClient>>,
  eventId: string
): Promise<Team[]> {
  const { data: finalTeams, error } = await supabase
    .from('teams')
    .select(`
      *,
      team_members(
        *,
        event_player:event_players(
          id,
          event_id,
          player_id,
          created_at,
          has_paid,
          pool,
          pfa_score,
          scoring_method,
          player:players(*)
        )
      )
    `)
    .eq('event_id', eventId)
    .order('seed');

  if (error) {
    throw new Error('Failed to fetch generated teams');
  }

  return (finalTeams || []) as unknown as Team[];
}
