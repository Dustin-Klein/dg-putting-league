import 'server-only';
import {
  BadRequestError,
  InternalError,
} from '@/lib/errors';
import { requireEventAdmin, getEventWithPlayers } from '@/lib/services/event';
import { EventPlayer } from '@/lib/types/player';
import type { Team, TeamMember } from '@/lib/types/team';
import * as teamRepo from '@/lib/repositories/team-repository';
import * as eventPlayerRepo from '@/lib/repositories/event-player-repository';

// Re-export types for consumers
export type { Team, TeamMember } from '@/lib/types/team';

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
  const existingTeams = await teamRepo.getTeamsForEvent(supabase, eventId);
  if (existingTeams.length > 0) {
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
        score = await eventPlayerRepo.getQualificationScore(supabase, eventId, player.id);
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
  const teamsToCreate: { poolAPlayer: EventPlayer; poolBPlayer: EventPlayer }[] = [];
  const minPoolSize = Math.min(poolAPlayers.length, poolBPlayers.length);

  for (let i = 0; i < minPoolSize; i++) {
    teamsToCreate.push({
      poolAPlayer: poolAPlayers[i],
      poolBPlayer: poolBPlayers[i],
    });
  }

  // Insert teams and collect their IDs
  const teamIdMap: Map<number, string> = new Map();

  for (let i = 0; i < teamsToCreate.length; i++) {
    const { poolAPlayer, poolBPlayer } = teamsToCreate[i];
    const poolCombo = `${poolAPlayer.player.full_name} & ${poolBPlayer.player.full_name}`;

    const teamId = await teamRepo.insertTeam(supabase, eventId, i + 1, poolCombo);
    teamIdMap.set(i, teamId);

    // Insert team members
    await teamRepo.insertTeamMember(supabase, teamId, poolAPlayer.id, 'A_pool');
    await teamRepo.insertTeamMember(supabase, teamId, poolBPlayer.id, 'B_pool');
  }

  // Fetch teams with members for seed calculation
  const teamsWithMembers = await teamRepo.getTeamsWithMembersForEvent(supabase, eventId);

  // Sort teams by combined qualification score and update seeds
  const teamsWithScores = teamsWithMembers.map(team => {
    const memberScores = team.team_members.map(member => {
      return playersWithScores.find(p => p.id === member.event_player_id)?.qualificationScore || 0;
    });
    const combinedScore = memberScores.reduce((sum, score) => sum + score, 0);

    return {
      ...team,
      combinedScore,
    };
  });

  teamsWithScores.sort((a, b) => b.combinedScore - a.combinedScore);

  // Update team seeds based on combined scores (in parallel)
  const seedUpdates = teamsWithScores.map((team, i) =>
    teamRepo.updateTeamSeed(supabase, team.id, i + 1)
  );

  await Promise.all(seedUpdates);

  // Fetch complete teams with members for return
  const finalTeams = await teamRepo.getFullTeamsForEvent(supabase, eventId);

  return finalTeams as unknown as Team[];
}

/**
 * Get teams for an event
 */
export async function getEventTeams(eventId: string): Promise<Team[]> {
  const { supabase } = await requireEventAdmin(eventId);
  const teams = await teamRepo.getFullTeamsForEvent(supabase, eventId);
  return teams as unknown as Team[];
}
