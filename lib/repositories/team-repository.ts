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

/**
 * Get team info from a bracket participant ID
 * Returns full player info including player ID (for admin use)
 */
export async function getTeamFromParticipant(
  supabase: Awaited<ReturnType<typeof createClient>>,
  participantId: number | null
): Promise<TeamWithPlayers | null> {
  if (!participantId) return null;

  const { data: participant } = await supabase
    .from('bracket_participant')
    .select('team_id')
    .eq('id', participantId)
    .single();

  if (!participant?.team_id) return null;

  const { data: team } = await supabase
    .from('teams')
    .select(`
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
    `)
    .eq('id', participant.team_id)
    .single();

  if (!team) return null;

  return {
    id: team.id,
    seed: team.seed,
    pool_combo: team.pool_combo,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    players: team.team_members?.map((tm: any) => ({
      event_player_id: tm.event_player_id,
      role: tm.role,
      player: tm.event_player?.player,
    })) || [],
  };
}

/**
 * Get team info from a bracket participant ID
 * Returns limited player info (for public use - no player ID)
 */
export async function getPublicTeamFromParticipant(
  supabase: Awaited<ReturnType<typeof createClient>>,
  participantId: number | null
): Promise<PublicTeamWithPlayers | null> {
  if (!participantId) return null;

  const { data: participant } = await supabase
    .from('bracket_participant')
    .select('team_id')
    .eq('id', participantId)
    .single();

  if (!participant?.team_id) return null;

  const { data: team } = await supabase
    .from('teams')
    .select(`
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
    `)
    .eq('id', participant.team_id)
    .single();

  if (!team) return null;

  return {
    id: team.id,
    seed: team.seed,
    pool_combo: team.pool_combo,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    players: team.team_members?.map((tm: any) => ({
      event_player_id: tm.event_player_id,
      role: tm.role,
      full_name: tm.event_player?.player?.full_name || 'Unknown',
      nickname: tm.event_player?.player?.nickname,
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
