import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { NotFoundError } from '@/lib/errors';
import type {
  PlayerProfile,
  PlayerStatistics,
  PlayerEventHistory,
} from '@/lib/types/player-statistics';
import * as playerStatsRepo from '@/lib/repositories/player-statistics-repository';

/**
 * Get complete player profile with statistics and event history
 */
export async function getPlayerProfile(playerNumber: number): Promise<PlayerProfile> {
  const supabase = await createClient();

  const player = await playerStatsRepo.getPlayerByNumber(supabase, playerNumber);
  if (!player) {
    throw new NotFoundError('Player not found');
  }

  const eventParticipations = await playerStatsRepo.getPlayerEventParticipations(
    supabase,
    player.id
  );

  if (eventParticipations.length === 0) {
    return {
      player,
      statistics: createEmptyStatistics(),
      eventHistory: [],
    };
  }

  const eventPlayerIds = eventParticipations.map((ep) => ep.eventPlayerId);
  const eventIds = [...new Set(eventParticipations.map((ep) => ep.eventId))];

  // First batch: fetch team info, frame results, and placements in parallel
  const [teamInfoMap, frameResults, placements] = await Promise.all([
    playerStatsRepo.getTeamInfoForEventPlayers(supabase, eventPlayerIds),
    playerStatsRepo.getPlayerFrameResultsWithDetails(supabase, eventPlayerIds),
    playerStatsRepo.getPlacementsForEvents(supabase, eventIds),
  ]);

  // Second: fetch match records (depends on team info)
  const teamIds = [...new Set([...teamInfoMap.values()].map((ti) => ti.teamId))];
  const matchRecordsByTeam = await playerStatsRepo.getMatchRecordsForTeams(
    supabase,
    teamIds,
    eventIds
  );

  const eventHistory = buildEventHistory(
    eventParticipations,
    teamInfoMap,
    matchRecordsByTeam,
    placements
  );

  const statistics = calculateStatistics(
    eventParticipations,
    matchRecordsByTeam,
    frameResults,
    placements,
    teamInfoMap
  );

  return {
    player,
    statistics,
    eventHistory,
  };
}

function createEmptyStatistics(): PlayerStatistics {
  return {
    eventsPlayed: 0,
    totalWins: 0,
    totalLosses: 0,
    winRate: 0,
    perFrameAverage: null,
    perfectMatches: 0,
    firstPlaceFinishes: 0,
    topThreeFinishes: 0,
  };
}

function buildEventHistory(
  participations: playerStatsRepo.EventParticipation[],
  teamInfoMap: Map<string, playerStatsRepo.TeamInfo>,
  matchRecordsByTeam: Map<string, { wins: number; losses: number }>,
  placements: playerStatsRepo.EventPlacementData[]
): PlayerEventHistory[] {
  const placementMap = new Map<string, number>();
  for (const p of placements) {
    placementMap.set(`${p.eventId}:${p.teamId}`, p.placement);
  }

  return participations.map((ep) => {
    const teamInfo = teamInfoMap.get(ep.eventPlayerId);
    const teamId = teamInfo?.teamId;
    // matchRecordsByTeam is keyed by "eventId:teamId" to track per-event records
    const record = teamId ? matchRecordsByTeam.get(`${ep.eventId}:${teamId}`) : undefined;
    const placement = teamId ? placementMap.get(`${ep.eventId}:${teamId}`) : undefined;

    return {
      eventId: ep.eventId,
      eventDate: ep.eventDate,
      leagueId: ep.leagueId,
      leagueName: ep.leagueName,
      pool: ep.pool,
      placement: placement ?? null,
      wins: record?.wins ?? 0,
      losses: record?.losses ?? 0,
      teammateId: teamInfo?.teammatePlayerId ?? null,
      teammateName: teamInfo?.teammateName ?? null,
      seed: teamInfo?.seed ?? null,
    };
  });
}

function calculateStatistics(
  participations: playerStatsRepo.EventParticipation[],
  matchRecordsByTeam: Map<string, { wins: number; losses: number }>,
  frameResults: playerStatsRepo.FrameResultData[],
  placements: playerStatsRepo.EventPlacementData[],
  teamInfoMap: Map<string, playerStatsRepo.TeamInfo>
): PlayerStatistics {
  const eventsPlayed = participations.length;

  let totalWins = 0;
  let totalLosses = 0;

  for (const record of matchRecordsByTeam.values()) {
    totalWins += record.wins;
    totalLosses += record.losses;
  }

  const totalMatches = totalWins + totalLosses;
  const winRate = totalMatches > 0 ? totalWins / totalMatches : 0;

  // Calculate PFA
  let perFrameAverage: number | null = null;
  if (frameResults.length > 0) {
    const totalPoints = frameResults.reduce((sum, fr) => sum + fr.pointsEarned, 0);
    perFrameAverage = totalPoints / frameResults.length;
  }

  // Calculate perfect matches
  const perfectMatches = calculatePerfectMatches(frameResults);

  // Calculate placement stats
  let firstPlaceFinishes = 0;
  let topThreeFinishes = 0;

  for (const teamInfo of teamInfoMap.values()) {
    for (const placement of placements) {
      if (placement.teamId === teamInfo.teamId) {
        if (placement.placement === 1) {
          firstPlaceFinishes++;
          topThreeFinishes++;
        } else if (placement.placement <= 3) {
          topThreeFinishes++;
        }
      }
    }
  }

  return {
    eventsPlayed,
    totalWins,
    totalLosses,
    winRate,
    perFrameAverage,
    perfectMatches,
    firstPlaceFinishes,
    topThreeFinishes,
  };
}

/**
 * A "perfect match" is when a player made 3 putts on every frame of that match
 */
function calculatePerfectMatches(frameResults: playerStatsRepo.FrameResultData[]): number {
  const framesByMatch = new Map<number, playerStatsRepo.FrameResultData[]>();

  for (const fr of frameResults) {
    if (!framesByMatch.has(fr.bracketMatchId)) {
      framesByMatch.set(fr.bracketMatchId, []);
    }
    framesByMatch.get(fr.bracketMatchId)!.push(fr);
  }

  let perfectCount = 0;

  for (const [, frames] of framesByMatch) {
    if (frames.length > 0 && frames.every((f) => f.puttsMade === 3)) {
      perfectCount++;
    }
  }

  return perfectCount;
}
