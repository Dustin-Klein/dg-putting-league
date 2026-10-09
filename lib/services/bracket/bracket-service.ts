import 'server-only';
import { BracketsManager, helpers } from 'brackets-manager';
import type { Match, Participant, Stage, Group, Round } from 'brackets-model';
import { Status } from 'brackets-model';
import { createClient } from '@/lib/supabase/server';
import { requireEventAdmin } from '@/lib/services/event';
import { authorizeEventView } from '@/lib/services/auth';
import { getEventTeams, Team } from '@/lib/services/team';
import { autoAssignLanesTx } from '@/lib/services/lane';
import { lockEvent, lockMatch, withTransaction, type Tx } from '@/lib/db/tx';
import { DrizzleBracketStorage } from '@/lib/repositories/bracket-storage.db';
import * as bracketDb from '@/lib/repositories/bracket-repository.db';
import { getTeamsForSeeding } from '@/lib/repositories/team-repository.db';
import { assignLane, getLanesForEvent, lockEventLanes, releaseMatchLane, resetOccupiedLanesToIdle } from '@/lib/repositories/lane-repository.db';
import { getFrameCountsForMatches } from '@/lib/repositories/frame-repository.db';
import { getEventAccessCode, getEventBracketConfig, getEventById } from '@/lib/repositories/event-repository.db';
import { clearScoreOverrides } from '@/lib/repositories/match-scores-repository.db';
import { setScoreOverride } from '@/lib/repositories/match-scores-repository.db';
import { syncMatchScores } from '@/lib/services/scoring/match-scores';
import {
  BadRequestError,
  InternalError,
  NotFoundError,
} from '@/lib/errors';
import { logger } from '@/lib/utils/logger';
import {
  bracketStageExists,
  getBracketStage,
  fetchBracketStructure,
  getParticipantsWithTeamIds,
  getReadyMatchesByStageId,
} from '@/lib/repositories/bracket-repository';
import type { BracketMatchForReset, BracketResetContext } from '@/lib/repositories/bracket-repository';
import { getPublicTeamsForEvent } from '@/lib/repositories/team-repository.db';
import type { EventStatus } from '@/lib/types/event';
import type {
  BracketWithTeams,
  MatchProgressionSources,
} from '@/lib/types/bracket';

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

type ProgressionMatchSlot = 'opponent1' | 'opponent2';

interface ProgressionContext {
  stage: Stage;
  groups: Group[];
  rounds: Round[];
  matches: Match[];
}

function toNumericId(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Build a map describing which source match/outcome feeds each target slot.
 * This powers UI labels such as "winner of M3" and "loser of M5".
 */
export async function buildProgressionSourceMap(
  context: ProgressionContext
): Promise<Record<number, MatchProgressionSources>> {
  const map: Record<number, MatchProgressionSources> = {};
  const matchById = new Map<number, Match>();
  const groupById = new Map<number, Group>();
  const roundById = new Map<number, Round>();
  const roundCountByGroupId = new Map<number, number>();
  const matchesByGroupRoundAndNumber = new Map<string, Match>();
  const { matches } = context;

  for (const group of context.groups) {
    const groupId = toNumericId(group.id);
    if (groupId == null) continue;
    groupById.set(groupId, group);
  }
  for (const round of context.rounds) {
    const roundId = toNumericId(round.id);
    const roundGroupId = toNumericId(round.group_id);
    if (roundId == null || roundGroupId == null) continue;
    roundById.set(roundId, round);
    roundCountByGroupId.set(roundGroupId, (roundCountByGroupId.get(roundGroupId) ?? 0) + 1);
  }

  for (const match of matches) {
    const matchId = toNumericId(match.id);
    const roundId = toNumericId(match.round_id);
    if (matchId == null || roundId == null) continue;
    matchById.set(matchId, match);
    const round = roundById.get(roundId);
    if (!round) continue;
    const groupId = toNumericId(round.group_id);
    const matchNumber = toNumericId(match.number);
    if (groupId == null || matchNumber == null) continue;
    matchesByGroupRoundAndNumber.set(`${groupId}:${round.number}:${matchNumber}`, match);
  }

  const finalGroup = context.groups.find((g) =>
    helpers.isFinalGroup(context.stage.type, g.number)
  );
  const loserGroup = context.groups.find((g) =>
    helpers.isLoserBracket(context.stage.type, g.number)
  );

  const getMatchByGroupRoundAndNumber = (
    groupId: number,
    roundNumber: number,
    matchNumber: number
  ): Match | null => {
    return (
      matchesByGroupRoundAndNumber.get(`${groupId}:${roundNumber}:${matchNumber}`) ??
      null
    );
  };

  const getFinalGroupFirstMatch = (): Match | null => {
    const finalGroupId = toNumericId(finalGroup?.id);
    if (finalGroupId == null) return null;
    return getMatchByGroupRoundAndNumber(finalGroupId, 1, 1);
  };

  const getConsolationFinalMatch = (): Match | null => {
    const finalGroupId = toNumericId(finalGroup?.id);
    return finalGroupId == null ? null : getMatchByGroupRoundAndNumber(finalGroupId, 1, 2);
  };

  const getNextDiagonalMatch = (sourceMatch: Match, sourceRoundNumber: number): Match | null => {
    const sourceGroupId = toNumericId(sourceMatch.group_id);
    const sourceMatchNumber = toNumericId(sourceMatch.number);
    if (sourceGroupId == null || sourceMatchNumber == null) return null;
    const targetMatchNumber = helpers.getDiagonalMatchNumber(sourceMatchNumber);
    return getMatchByGroupRoundAndNumber(
      sourceGroupId,
      sourceRoundNumber + 1,
      targetMatchNumber
    );
  };

  const getNextParallelMatch = (sourceMatch: Match, sourceRoundNumber: number): Match | null => {
    const sourceGroupId = toNumericId(sourceMatch.group_id);
    const sourceMatchNumber = toNumericId(sourceMatch.number);
    if (sourceGroupId == null || sourceMatchNumber == null) return null;
    return getMatchByGroupRoundAndNumber(
      sourceGroupId,
      sourceRoundNumber + 1,
      sourceMatchNumber
    );
  };

  const resolveNextTargets = (
    sourceMatch: Match
  ): { winnerTarget: Match | null; loserTarget: Match | null } => {
    const sourceRound = roundById.get(Number(sourceMatch.round_id));
    const sourceGroup = groupById.get(Number(sourceMatch.group_id));
    if (!sourceRound || !sourceGroup) {
      return { winnerTarget: null, loserTarget: null };
    }

    const roundNumber = sourceRound.number;
    const roundCount = roundCountByGroupId.get(Number(sourceGroup.id));
    if (!roundCount) {
      return { winnerTarget: null, loserTarget: null };
    }

    const stage = context.stage;
    const matchLocation = helpers.getMatchLocation(stage.type as never, sourceGroup.number);
    const consolationFinalEnabled = Boolean(stage.settings?.consolationFinal);

    if (matchLocation === 'single_bracket') {
      if (roundNumber === roundCount - 1) {
        return {
          winnerTarget: getNextDiagonalMatch(sourceMatch, roundNumber),
          loserTarget: consolationFinalEnabled ? getConsolationFinalMatch() : null,
        };
      }
      if (roundNumber === roundCount) {
        return { winnerTarget: null, loserTarget: null };
      }
      return {
        winnerTarget: getNextDiagonalMatch(sourceMatch, roundNumber),
        loserTarget: null,
      };
    }

    if (matchLocation === 'winner_bracket') {
      const winnerTarget =
        roundNumber === roundCount
          ? getFinalGroupFirstMatch()
          : getNextDiagonalMatch(sourceMatch, roundNumber);

      const loserGroupId = toNumericId(loserGroup?.id);
      const sourceMatchNumber = toNumericId(sourceMatch.number);
      const participantCount = Number(stage.settings?.size ?? 0);
      if (
        loserGroupId == null ||
        sourceMatchNumber == null ||
        !Number.isFinite(participantCount) ||
        participantCount <= 0
      ) {
        return { winnerTarget, loserTarget: null };
      }

      const actualRoundNumber = stage.settings?.skipFirstRound ? roundNumber + 1 : roundNumber;
      const roundNumberLB = actualRoundNumber > 1 ? (actualRoundNumber - 1) * 2 : 1;
      const loserOrdering = helpers.getLoserOrdering(
        (stage.settings?.seedOrdering ?? []) as never,
        roundNumberLB
      );
      const loserMatchNumber = helpers.findLoserMatchNumber(
        participantCount,
        roundNumberLB,
        sourceMatchNumber,
        loserOrdering
      );
      const loserTarget = getMatchByGroupRoundAndNumber(
        loserGroupId,
        roundNumberLB,
        loserMatchNumber
      );
      return { winnerTarget, loserTarget };
    }

    if (matchLocation === 'loser_bracket') {
      if (roundNumber === roundCount - 1) {
        return {
          winnerTarget: getNextParallelMatch(sourceMatch, roundNumber),
          loserTarget: consolationFinalEnabled ? getConsolationFinalMatch() : null,
        };
      }
      if (roundNumber === roundCount) {
        return {
          winnerTarget: getFinalGroupFirstMatch(),
          loserTarget: consolationFinalEnabled ? getConsolationFinalMatch() : null,
        };
      }
      if (helpers.isMajorRound(roundNumber)) {
        return {
          winnerTarget: getNextParallelMatch(sourceMatch, roundNumber),
          loserTarget: null,
        };
      }
      return {
        winnerTarget: getNextDiagonalMatch(sourceMatch, roundNumber),
        loserTarget: null,
      };
    }

    if (matchLocation === 'final_group') {
      if (roundNumber === roundCount) {
        return { winnerTarget: null, loserTarget: null };
      }
      const matchNumber = toNumericId(sourceMatch.number);
      // In final_group: grand final is match #1 and consolation final is match #2.
      if (matchNumber !== 1) {
        return { winnerTarget: null, loserTarget: null };
      }

      const groupId = toNumericId(sourceMatch.group_id);
      if (groupId == null) {
        return { winnerTarget: null, loserTarget: null };
      }

      return {
        winnerTarget: getMatchByGroupRoundAndNumber(groupId, roundNumber + 1, 1),
        loserTarget: null,
      };
    }

    return { winnerTarget: null, loserTarget: null };
  };

  const resolveWinnerSlot = (sourceMatch: Match): ProgressionMatchSlot | null => {
    const sourceGroup = groupById.get(Number(sourceMatch.group_id));
    const sourceRound = roundById.get(Number(sourceMatch.round_id));
    const sourceMatchNumber = toNumericId(sourceMatch.number);
    if (!sourceGroup || !sourceRound || sourceMatchNumber == null) return null;
    const roundCount = roundCountByGroupId.get(Number(sourceGroup.id));
    if (!roundCount) return null;
    const matchLocation = helpers.getMatchLocation(context.stage.type as never, sourceGroup.number);
    const adjustedRoundNumber =
      context.stage.settings?.skipFirstRound && matchLocation === 'winner_bracket'
        ? sourceRound.number + 1
        : sourceRound.number;
    return helpers.getNextSide(
      sourceMatchNumber,
      adjustedRoundNumber,
      roundCount,
      matchLocation
    ) as ProgressionMatchSlot;
  };

  const resolveLoserSlot = (sourceMatch: Match, targetMatch: Match): ProgressionMatchSlot | null => {
    const sourceGroup = groupById.get(Number(sourceMatch.group_id));
    const sourceRound = roundById.get(Number(sourceMatch.round_id));
    const sourceMatchNumber = toNumericId(sourceMatch.number);
    if (!sourceGroup || !sourceRound || sourceMatchNumber == null) return null;
    const roundCount = roundCountByGroupId.get(Number(sourceGroup.id));
    if (!roundCount) return null;
    const matchLocation = helpers.getMatchLocation(context.stage.type as never, sourceGroup.number);
    const adjustedRoundNumber =
      context.stage.settings?.skipFirstRound && matchLocation === 'winner_bracket'
        ? sourceRound.number + 1
        : sourceRound.number;

    if (matchLocation === 'winner_bracket') {
      return helpers.getNextSideLoserBracket(
        sourceMatchNumber,
        targetMatch,
        adjustedRoundNumber
      ) as ProgressionMatchSlot;
    }

    if (matchLocation === 'loser_bracket') {
      return helpers.getNextSideConsolationFinalDoubleElimination(
        adjustedRoundNumber
      ) as ProgressionMatchSlot;
    }

    if (matchLocation === 'single_bracket') {
      return resolveWinnerSlot(sourceMatch);
    }

    return null;
  };

  for (const sourceMatch of matches) {
    const sourceMatchId = toNumericId(sourceMatch.id);
    if (sourceMatchId == null) continue;

    const { winnerTarget, loserTarget } = resolveNextTargets(sourceMatch);

    const winnerTargetId = toNumericId(winnerTarget?.id);
    if (winnerTargetId != null) {
      const winnerSlot = resolveWinnerSlot(sourceMatch);
      if (winnerSlot) {
        if (!map[winnerTargetId]) map[winnerTargetId] = {};
        map[winnerTargetId][winnerSlot] = {
          sourceMatchId,
          sourceOutcome: 'winner',
        };
      }
    }

    const loserTargetId = toNumericId(loserTarget?.id);
    if (loserTargetId != null) {
      const loserTargetMatch = matchById.get(loserTargetId);
      if (!loserTargetMatch) continue;
      const loserSlot = resolveLoserSlot(sourceMatch, loserTargetMatch);
      if (!loserSlot) continue;
      if (!map[loserTargetId]) map[loserTargetId] = {};
      map[loserTargetId][loserSlot] = {
        sourceMatchId,
        sourceOutcome: 'loser',
      };
    }
  }

  return map;
}

/**
 * Create the double-elimination bracket for an event from its teams (seed order),
 * inside the caller's transaction, which must hold the event lock: brackets-manager
 * structure, participant → team links, and first-round matches set Ready.
 */
export async function createBracketTx(
  tx: Tx,
  eventId: string,
  doubleGrandFinal: boolean
): Promise<void> {
  if (await bracketDb.getStageForEvent(tx, eventId)) {
    throw new BadRequestError('Bracket has already been created for this event');
  }

  const teams = await getTeamsForSeeding(tx, eventId);
  if (teams.length < 2) {
    throw new BadRequestError('At least 2 teams are required to create a bracket');
  }

  const sortedTeams = [...teams].sort((a, b) => (a.seed || 0) - (b.seed || 0));

  // brackets-manager requires participant count to be a power of 2
  const bracketSize = nextPowerOf2(sortedTeams.length);
  const seeding: (string | null)[] = sortedTeams.map((team) => team.pool_combo ?? `Team ${team.seed}`);

  // Fill remaining slots with BYEs
  while (seeding.length < bracketSize) {
    seeding.push(null);
  }

  const manager = new BracketsManager(new DrizzleBracketStorage(tx, eventId));
  await manager.create.stage({
    tournamentId: eventId as unknown as number,
    name: 'Double Elimination',
    type: 'double_elimination',
    seeding,
    settings: {
      grandFinal: doubleGrandFinal ? 'double' : 'simple',
      seedOrdering: ['inner_outer'],
      balanceByes: true,
    },
  });

  // Participants are created in seeding order.
  const participants = await bracketDb.getParticipantsForEvent(tx, eventId);
  await bracketDb.linkParticipantsToTeams(
    tx,
    eventId,
    participants
      .map((participant, i) => ({ participantId: participant.id, teamId: sortedTeams[i]?.id }))
      .filter((m): m is { participantId: number; teamId: string } => m.teamId !== undefined)
  );

  const stage = await bracketDb.getStageForEvent(tx, eventId);
  if (!stage) {
    throw new InternalError('Bracket stage was not created');
  }
  await bracketDb.setEventIdOnMatches(tx, stage.id, eventId);
  await bracketDb.setFilledMatchesReady(tx, stage.id);
}

/**
 * Create a double elimination bracket for an event that is already in bracket play
 * but has no bracket yet.
 */
export async function createBracket(eventId: string): Promise<BracketData> {
  const { pg } = await requireEventAdmin(eventId);

  await withTransaction(pg, async (tx) => {
    await lockEvent(tx, eventId);
    const event = await getEventBracketConfig(tx, eventId, { lock: 'share' });
    if (!event) {
      throw new NotFoundError('Event not found');
    }
    if (event.status !== 'bracket') {
      throw new BadRequestError('Bracket can only be created for events in bracket status');
    }
    await createBracketTx(tx, eventId, event.double_grand_final);
  });

  return getBracket(eventId);
}

/**
 * Get public bracket data with teams and lanes
 */
export async function getPublicBracket(eventId: string): Promise<BracketWithTeams> {
  const { pg, isAdmin } = await authorizeEventView(eventId, 'bracket');
  const supabase = await createClient();

  const event = await getEventById(pg, eventId);

  if (!event) {
    throw new NotFoundError('Event not found');
  }

  // Only allow viewing bracket for events in bracket or completed status
  if (event.status !== 'bracket' && event.status !== 'completed') {
    throw new NotFoundError('Bracket not available for this event');
  }

  // Fetch all data in parallel
  const [bracketStructure, teams, lanes] = await Promise.all([
    fetchBracketStructure(supabase, eventId),
    getPublicTeamsForEvent(pg, eventId),
    // Anonymous lane RLS hid lanes after completion; league admins could still see them.
    event.status === 'bracket' || isAdmin ? getLanesForEvent(pg, eventId) : Promise.resolve([]),
  ]);

  if (!bracketStructure) {
    throw new NotFoundError('Bracket not found for this event');
  }

  const { stage, groups, rounds, matches, participants } = bracketStructure;

  // Apply same filtering as admin view when double_grand_final is disabled
  let effectiveRounds = rounds as Round[];
  let effectiveMatches = matches as Match[];
  if (!event.double_grand_final) {
    const gfGroup = (groups as Group[]).find((g) => g.number === GRAND_FINAL_GROUP_NUMBER);
    if (gfGroup) {
      const resetRound = effectiveRounds.find(
        (r) => r.group_id === gfGroup.id && r.number === 2
      );
      if (resetRound) {
        effectiveRounds = effectiveRounds.filter((r) => r.id !== resetRound.id);
        effectiveMatches = effectiveMatches.filter((m) => m.round_id !== resetRound.id);
      }
    }
  }

  // Fetch frame counts for running matches
  const runningMatchIds = (effectiveMatches as Array<{ id: number; status: number }>)
    .filter((m) => m.status === Status.Running)
    .map((m) => m.id);
  const frameCountMap = await getFrameCountsForMatches(pg, runningMatchIds);

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

  const progressionSourceMap = await buildProgressionSourceMap(
    {
      stage: stage as unknown as Stage,
      groups: groups as unknown as Group[],
      rounds: effectiveRounds,
      matches: effectiveMatches,
    }
  );

  return {
    bracket: {
      stage: stage as unknown as Stage,
      groups: groups as unknown as Group[],
      rounds: effectiveRounds,
      matches: effectiveMatches,
      participants: participants as unknown as Participant[],
    },
    teams,
    participantTeamMap,
    lanes,
    laneMap,
    eventStatus: event.status,
    bracketFrameCount: event.bracket_frame_count ?? undefined,
    frameCountMap,
    progressionSourceMap,
  };
}

/**
 * Get the bracket data for an event
 */
export async function getBracket(eventId: string): Promise<BracketData> {
  const { supabase } = await requireEventAdmin(eventId);

  const bracketStructure = await fetchBracketStructure(supabase, eventId);

  if (!bracketStructure) {
    throw new NotFoundError('Bracket not found for this event');
  }

  return {
    stage: bracketStructure.stage as unknown as Stage,
    groups: bracketStructure.groups as unknown as Group[],
    rounds: bracketStructure.rounds as unknown as Round[],
    matches: bracketStructure.matches as unknown as Match[],
    participants: bracketStructure.participants as unknown as Participant[],
  };
}

/**
 * Get bracket data with team information included
 */
export async function getBracketWithTeams(eventId: string): Promise<{
  bracket: BracketData;
  teams: Team[];
  participantTeamMap: Record<number, Team>;
  eventStatus?: EventStatus;
  accessCode?: string;
  bracketFrameCount?: number;
  frameCountMap: Record<number, number>;
  progressionSourceMap: Record<number, MatchProgressionSources>;
}> {
  const { supabase, pg } = await requireEventAdmin(eventId);

  const [bracket, teams, event, accessCode, participantsWithTeams] = await Promise.all([
    getBracket(eventId),
    getEventTeams(eventId),
    getEventById(pg, eventId),
    getEventAccessCode(pg, eventId),
    getParticipantsWithTeamIds(supabase, eventId),
  ]);

  let effectiveBracket = bracket;
  if (event && !event.double_grand_final) {
    const gfGroup = bracket.groups.find((g) => g.number === GRAND_FINAL_GROUP_NUMBER);
    if (gfGroup) {
      const resetRound = bracket.rounds.find(
        (r) => r.group_id === gfGroup.id && r.number === 2
      );
      if (resetRound) {
        effectiveBracket = {
          ...bracket,
          rounds: bracket.rounds.filter((r) => r.id !== resetRound.id),
          matches: bracket.matches.filter((m) => m.round_id !== resetRound.id),
        };
      }
    }
  }

  const runningMatchIds = effectiveBracket.matches
    .filter((m) => m.status === Status.Running)
    .map((m) => m.id as number);
  const frameCountMap = await getFrameCountsForMatches(pg, runningMatchIds);
  const progressionSourceMap = await buildProgressionSourceMap(
    {
      stage: effectiveBracket.stage,
      groups: effectiveBracket.groups,
      rounds: effectiveBracket.rounds,
      matches: effectiveBracket.matches,
    }
  );

  const participantTeamMap: Record<number, Team> = {};

  for (const p of participantsWithTeams) {
    const team = teams.find((t) => t.id === p.team_id);
    if (team) {
      participantTeamMap[p.id] = team;
    }
  }

  return {
    bracket: effectiveBracket,
    teams,
    participantTeamMap,
    eventStatus: event?.status,
    accessCode: accessCode ?? undefined,
    bracketFrameCount: event?.bracket_frame_count ?? undefined,
    frameCountMap,
    progressionSourceMap,
  };
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
  const { pg, user } = await requireEventAdmin(eventId);

  await withTransaction(pg, async (tx) => {
    await lockEvent(tx, eventId);
    await requireBracketPlay(tx, eventId);

    const match = await lockMatch(tx, matchId, eventId);
    if (!match) {
      throw new NotFoundError('Match not found');
    }
    // Completed results change only through score correction (same winner) or reset,
    // which keep downstream progression consistent.
    if (match.status === Status.Completed || match.status === Status.Archived) {
      throw new BadRequestError('This match is already completed. Use score correction or "Reset match" instead.');
    }

    let result1: 'win' | 'loss' | 'draw' | undefined;
    let result2: 'win' | 'loss' | 'draw' | undefined;

    if (winnerId !== undefined) {
      const opp1 = match.opponent1 as { id?: number | null } | null;
      const opp2 = match.opponent2 as { id?: number | null } | null;

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
      } else {
        throw new BadRequestError('Winner ID does not match any opponent in this match');
      }
    } else if (opponent1Score !== opponent2Score) {
      if (opponent1Score > opponent2Score) {
        result1 = 'win';
        result2 = 'loss';
      } else {
        result1 = 'loss';
        result2 = 'win';
      }
    }

    const manager = new BracketsManager(new DrizzleBracketStorage(tx, eventId));
    await setScoreOverride(
      tx,
      matchId,
      { team1Score: opponent1Score, team2Score: opponent2Score },
      'manual match update',
      user.id
    );
    await syncMatchScores(tx, matchId);
    await manager.update.match({
      id: matchId,
      opponent1: { score: opponent1Score, result: result1 },
      opponent2: { score: opponent2Score, result: result2 },
    });
    await syncMatchScores(tx, matchId);
  });

  const updatedMatch = await bracketDb.getMatchForScoringById(pg, matchId);

  if (!updatedMatch) {
    throw new InternalError('Failed to fetch updated match');
  }

  return updatedMatch as unknown as Match;
}

async function requireBracketPlay(tx: Tx, eventId: string) {
  const event = await getEventBracketConfig(tx, eventId, { lock: 'share' });
  if (!event) {
    throw new NotFoundError('Event not found');
  }
  if (event.status !== 'bracket') {
    throw new BadRequestError('Event is not in bracket play');
  }
  return event;
}

/**
 * Get matches that are ready to be played
 */
export async function getReadyMatches(eventId: string): Promise<Match[]> {
  const { supabase } = await requireEventAdmin(eventId);

  const stage = await getBracketStage(supabase, eventId);

  if (!stage) {
    throw new NotFoundError('Bracket not found');
  }

  return getReadyMatchesByStageId(supabase, stage.id);
}

/**
 * Put a match on an idle lane (manual assignment)
 */
export async function assignLaneToMatch(
  eventId: string,
  matchId: number,
  laneId: string
): Promise<void> {
  const { pg } = await requireEventAdmin(eventId);

  await withTransaction(pg, async (tx) => {
    await lockEvent(tx, eventId);
    await requireBracketPlay(tx, eventId);

    const match = await lockMatch(tx, matchId, eventId);
    const lane = (await lockEventLanes(tx, eventId)).find((l) => l.id === laneId);
    if (!lane) {
      throw new NotFoundError('Lane not found');
    }
    if (!match || lane.status !== 'idle' || !(await assignLane(tx, eventId, laneId, matchId))) {
      throw new BadRequestError('Lane is not available for assignment');
    }
  });
}

/**
 * Check if bracket exists for an event
 */
export async function bracketExists(eventId: string): Promise<boolean> {
  const supabase = await createClient();
  return bracketStageExists(supabase, eventId);
}

/**
 * Manually advance a team into a match slot
 */
export async function manuallyAdvanceTeam(
  eventId: string,
  targetMatchId: number,
  participantId: number,
  slot: 'opponent1' | 'opponent2'
): Promise<void> {
  const { pg } = await requireEventAdmin(eventId);

  await withTransaction(pg, async (tx) => {
    await lockEvent(tx, eventId);
    await requireBracketPlay(tx, eventId);

    const match = await lockMatch(tx, targetMatchId, eventId);

    if (!match) {
      throw new NotFoundError('Match not found');
    }

    if (match.status === Status.Completed || match.status === Status.Running) {
      throw new BadRequestError('Cannot advance into a match that is completed or running');
    }

    if (slot === 'opponent1' && (match.opponent1 as { id?: number | null } | null)?.id != null) {
      throw new BadRequestError('Top slot is already occupied');
    }
    if (slot === 'opponent2' && (match.opponent2 as { id?: number | null } | null)?.id != null) {
      throw new BadRequestError('Bottom slot is already occupied');
    }

    // Verify participant exists for this event
    const participants = await bracketDb.getParticipantsForEvent(tx, eventId);
    if (!participants.some((p) => p.id === participantId)) {
      throw new BadRequestError('Participant not found in this event');
    }

    const newOpponent = { id: participantId };

    await bracketDb.mergeMatchOpponents(
      tx,
      match,
      slot === 'opponent1' ? newOpponent : null,
      slot === 'opponent2' ? newOpponent : null,
      match.status
    );
  });
}

/**
 * Remove a team from a match slot
 */
export async function removeTeamFromMatch(
  eventId: string,
  targetMatchId: number,
  slot: 'opponent1' | 'opponent2'
): Promise<void> {
  const { pg, user } = await requireEventAdmin(eventId);

  await withTransaction(pg, async (tx) => {
    await lockEvent(tx, eventId);
    await requireBracketPlay(tx, eventId);

    const match = await lockMatch(tx, targetMatchId, eventId);

    if (!match) {
      throw new NotFoundError('Match not found');
    }

    if (match.status === Status.Completed || match.status === Status.Running) {
      throw new BadRequestError('Cannot remove a team from a match that is completed or running');
    }

    const opponent = slot === 'opponent1' ? match.opponent1 : match.opponent2;
    if (!opponent || (opponent as { id?: number | null }).id == null) {
      throw new BadRequestError('Slot is already empty');
    }

    const emptyOpponent = { id: null };

    await bracketDb.mergeMatchOpponents(
      tx,
      match,
      slot === 'opponent1' ? emptyOpponent : null,
      slot === 'opponent2' ? emptyOpponent : null,
      match.status
    );
  });

  logger.info('Team removed from match', {
    userId: user.id,
    action: 'remove_team_from_match',
    eventId,
    matchId: targetMatchId,
    slot,
    outcome: 'success',
  });
}

/**
 * Clear all bracket placements (reset match opponents to null)
 * Preserves the bracket structure and participants
 */
export async function clearBracketPlacements(eventId: string): Promise<BracketData> {
  const { pg, user } = await requireEventAdmin(eventId);

  const stage = await withTransaction(pg, async (tx) => {
    await lockEvent(tx, eventId);

    const stage = await bracketDb.getStageForEvent(tx, eventId);
    if (!stage) {
      throw new NotFoundError('Bracket not found for this event');
    }

    await bracketDb.clearAllMatchOpponents(tx, stage.id);
    await lockEventLanes(tx, eventId);
    await resetOccupiedLanesToIdle(tx, eventId);
    return stage;
  });

  logger.info('Bracket placements cleared', {
    userId: user.id,
    action: 'clear_bracket_placements',
    eventId,
    stageId: stage.id,
    outcome: 'success',
  });

  return getBracket(eventId);
}

const GRAND_FINAL_GROUP_NUMBER = 3;
const FIRST_GF_ROUND_NUMBER = 1;
type MatchSlot = 'opponent1' | 'opponent2';
type NextMatchesResolver = (matchId: number) => Promise<number[]>;

export interface TaintedSlotPlan {
  affectedMatchIds: number[];
  taintedSlotsByMatch: Map<number, Set<MatchSlot>>;
  depthByMatchId: Map<number, number>;
}

/**
 * Build a deterministic downstream taint plan from a target match.
 */
export async function buildTaintedSlotPlan(
  targetMatchId: number,
  context: BracketResetContext,
  nextMatchesResolver: NextMatchesResolver
): Promise<TaintedSlotPlan> {
  const matchById = new Map(context.matches.map((match) => [match.id, match]));
  const groupById = new Map(context.groups.map((group) => [group.id, group]));
  const roundById = new Map(context.rounds.map((round) => [round.id, round]));
  const roundCountByGroupId = new Map<number, number>();
  for (const round of context.rounds) {
    roundCountByGroupId.set(round.group_id, (roundCountByGroupId.get(round.group_id) ?? 0) + 1);
  }

  if (!matchById.has(targetMatchId)) {
    throw new InternalError(`Target match ${targetMatchId} not found in reset context`);
  }

  const taintedSlotsByMatch = new Map<number, Set<MatchSlot>>();
  const descendantIds = new Set<number>();
  const depthByMatchId = new Map<number, number>([[targetMatchId, 0]]);
  const visited = new Set<number>([targetMatchId]);
  const queue: Array<{ matchId: number; depth: number }> = [{ matchId: targetMatchId, depth: 0 }];
  const normalizePosition = (value: unknown): number | null => {
    if (value == null) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };
  const slotPointsToParent = (position: unknown, parentMatch: BracketResetContext['matches'][number]): boolean => {
    const normalized = normalizePosition(position);
    if (normalized == null) return false;
    return normalized === parentMatch.id || normalized === parentMatch.number;
  };
  const resolveTaintedSlot = (
    parentMatch: BracketResetContext['matches'][number],
    childMatch: BracketResetContext['matches'][number],
    fallback: MatchSlot
  ): MatchSlot => {
    const opp1PointsToParent = slotPointsToParent(childMatch.opponent1?.position, parentMatch);
    const opp2PointsToParent = slotPointsToParent(childMatch.opponent2?.position, parentMatch);

    if (opp1PointsToParent !== opp2PointsToParent) {
      return opp1PointsToParent ? 'opponent1' : 'opponent2';
    }

    // Historical rows with byes/manual edits may lose one side's `position`.
    // If only one side has a different explicit source, the parent feeds the unpinned side.
    if (!opp1PointsToParent && !opp2PointsToParent) {
      const opp1HasPosition = normalizePosition(childMatch.opponent1?.position) != null;
      const opp2HasPosition = normalizePosition(childMatch.opponent2?.position) != null;
      if (opp1HasPosition !== opp2HasPosition) {
        return opp1HasPosition ? 'opponent2' : 'opponent1';
      }
    }

    return fallback;
  };

  const taintSlot = (matchId: number, slot: MatchSlot): void => {
    if (!taintedSlotsByMatch.has(matchId)) {
      taintedSlotsByMatch.set(matchId, new Set<MatchSlot>());
    }
    taintedSlotsByMatch.get(matchId)!.add(slot);
  };

  for (let i = 0; i < queue.length; i += 1) {
    const { matchId: currentMatchId, depth } = queue[i];
    const currentMatch = matchById.get(currentMatchId);
    if (!currentMatch) continue;

    const currentGroup = groupById.get(currentMatch.group_id);
    if (!currentGroup) {
      throw new InternalError(`Group ${currentMatch.group_id} not found for match ${currentMatchId}`);
    }

    const currentRound = roundById.get(currentMatch.round_id);
    if (!currentRound) {
      throw new InternalError(`Round ${currentMatch.round_id} not found for match ${currentMatchId}`);
    }

    const roundCount = roundCountByGroupId.get(currentMatch.group_id);
    if (!roundCount) {
      throw new InternalError(`Round count not found for group ${currentMatch.group_id}`);
    }

    const matchLocation = helpers.getMatchLocation(context.stage.type as never, currentGroup.number);
    const adjustedRoundNumber =
      context.stage.settings?.skipFirstRound && matchLocation === 'winner_bracket'
        ? currentRound.number + 1
        : currentRound.number;

    const rawNextIds = await nextMatchesResolver(currentMatchId);
    const nextIds: number[] = [];
    const dedup = new Set<number>();
    for (const nextId of rawNextIds) {
      if (dedup.has(nextId)) continue;
      if (!matchById.has(nextId)) continue;
      dedup.add(nextId);
      nextIds.push(nextId);
    }

    if (matchLocation === 'final_group') {
      const firstNextMatchId = nextIds[0];
      if (firstNextMatchId != null) {
        taintSlot(firstNextMatchId, 'opponent1');
        taintSlot(firstNextMatchId, 'opponent2');
      }
    } else {
      const nextSide = helpers.getNextSide(
        currentMatch.number,
        adjustedRoundNumber,
        roundCount,
        matchLocation
      ) as MatchSlot;

      if (nextIds[0] != null) {
        const winnerNextMatch = matchById.get(nextIds[0]);
        const resolvedSide = winnerNextMatch
          ? resolveTaintedSlot(currentMatch, winnerNextMatch, nextSide)
          : nextSide;
        taintSlot(nextIds[0], resolvedSide);
      }

      if (nextIds[1] != null) {
        const secondNextMatchId = nextIds[1];
        if (matchLocation === 'single_bracket') {
          const secondNextMatch = matchById.get(secondNextMatchId);
          const resolvedSide = secondNextMatch
            ? resolveTaintedSlot(currentMatch, secondNextMatch, nextSide)
            : nextSide;
          taintSlot(secondNextMatchId, resolvedSide);
        } else if (matchLocation === 'winner_bracket') {
          const secondNextMatch = matchById.get(secondNextMatchId);
          if (secondNextMatch) {
            const sideIntoLoserBracket = helpers.getNextSideLoserBracket(
              currentMatch.number,
              secondNextMatch as unknown as Match,
              adjustedRoundNumber
            ) as MatchSlot;
            const resolvedSide = resolveTaintedSlot(
              currentMatch,
              secondNextMatch,
              sideIntoLoserBracket
            );
            taintSlot(secondNextMatchId, resolvedSide);
          }
        } else if (matchLocation === 'loser_bracket') {
          const sideIntoConsolation = helpers.getNextSideConsolationFinalDoubleElimination(
            adjustedRoundNumber
          ) as MatchSlot;
          const secondNextMatch = matchById.get(secondNextMatchId);
          const resolvedSide = secondNextMatch
            ? resolveTaintedSlot(currentMatch, secondNextMatch, sideIntoConsolation)
            : sideIntoConsolation;
          taintSlot(secondNextMatchId, resolvedSide);
        }
      }
    }

    for (const nextId of nextIds) {
      if (nextId === targetMatchId) continue;
      descendantIds.add(nextId);

      const nextDepth = depth + 1;
      const existingDepth = depthByMatchId.get(nextId);
      if (existingDepth == null || nextDepth < existingDepth) {
        depthByMatchId.set(nextId, nextDepth);
      }

      if (!visited.has(nextId)) {
        visited.add(nextId);
        queue.push({ matchId: nextId, depth: nextDepth });
      }
    }
  }

  const affectedMatchIds = [...descendantIds].sort((a, b) => {
    const depthDiff = (depthByMatchId.get(a) ?? Number.MAX_SAFE_INTEGER) - (depthByMatchId.get(b) ?? Number.MAX_SAFE_INTEGER);
    if (depthDiff !== 0) return depthDiff;
    return a - b;
  });

  return {
    affectedMatchIds,
    taintedSlotsByMatch,
    depthByMatchId,
  };
}

/**
 * Reset the result of a bracket match and deterministically rewrite affected descendants.
 */
export async function resetMatchResult(
  eventId: string,
  matchId: number,
  workflow?: {
    correctionReason?: string;
    winnerChangeVerified?: boolean;
    teamsNotified?: boolean;
  }
): Promise<{ resetMatchIds: number[] }> {
  const { pg, user } = await requireEventAdmin(eventId);

  // Rewrites, frame deletes, grand-final archive and lane release/reassignment all
  // commit together, under the event lock.
  const { resetMatchIds, taintPlan } = await withTransaction(pg, async (tx) => {
    await lockEvent(tx, eventId);
    await requireBracketPlay(tx, eventId);

    const context = await bracketDb.getBracketResetContext(tx, eventId);
    if (!context) {
      throw new NotFoundError('Match not found');
    }

    const targetMatch = context.matches.find((m) => m.id === matchId);

    if (!targetMatch) {
      throw new NotFoundError('Match not found');
    }

    const targetResettableStatuses = new Set([Status.Completed, Status.Running, Status.Archived]);
    if (!targetResettableStatuses.has(targetMatch.status)) {
      throw new BadRequestError('Only completed, running, or archived matches can be reset');
    }

    const manager = new BracketsManager(new DrizzleBracketStorage(tx, eventId));
    const managerFind = (
      manager as unknown as {
        find?: {
          nextMatches?: (matchId: number) => Promise<Array<{ id: number }>>;
        };
      }
    ).find;
    const toMatchId = (id: unknown): number | null => {
      const parsed = Number(id);
      return Number.isFinite(parsed) ? parsed : null;
    };

    if (!managerFind?.nextMatches) {
      throw new InternalError('Bracket reset graph traversal is unavailable');
    }

    const nextMatchesResolver = async (currentId: number): Promise<number[]> => {
      const nextMatches = await managerFind.nextMatches!(currentId);
      return nextMatches
        .map((nextMatch) => toMatchId((nextMatch as { id: unknown }).id))
        .filter((nextId): nextId is number => nextId != null);
    };

    const taintPlan = await buildTaintedSlotPlan(matchId, context, nextMatchesResolver);
    const resetMatchIds = [matchId, ...taintPlan.affectedMatchIds.filter((id) => id !== matchId)];
    const baselineById = new Map<number, BracketMatchForReset>(context.matches.map((match) => [match.id, match]));

    // Matches being reset give their lanes back; free lanes are reassigned at the end.
    for (const { id } of await bracketDb.getMatchesWithLanes(tx, resetMatchIds)) {
      await releaseMatchLane(tx, eventId, id);
    }

    for (const currentId of resetMatchIds) {
      const baselineMatch = baselineById.get(currentId);
      if (!baselineMatch) {
        throw new InternalError(`Match ${currentId} not found in baseline reset snapshot`);
      }

      const taintedSlots = taintPlan.taintedSlotsByMatch.get(currentId) ?? new Set<MatchSlot>();
      const isTargetMatch = currentId === matchId;
      const desiredOpponent1Id =
        !isTargetMatch && taintedSlots.has('opponent1') ? null : baselineMatch.opponent1?.id ?? null;
      const desiredOpponent2Id =
        !isTargetMatch && taintedSlots.has('opponent2') ? null : baselineMatch.opponent2?.id ?? null;
      const opp1WasLiteralNull = baselineMatch.opponent1 === null;
      const opp2WasLiteralNull = baselineMatch.opponent2 === null;

      // Preserve BYE semantics: literal `null` must remain SQL NULL, not `{id:null}`.
      const scrubOpponent1 = opp1WasLiteralNull ? null : { id: null };
      const scrubOpponent2 = opp2WasLiteralNull ? null : { id: null };
      const restoreOpponent1 = desiredOpponent1Id != null
        ? { id: desiredOpponent1Id }
        : (opp1WasLiteralNull ? null : { id: null });
      const restoreOpponent2 = desiredOpponent2Id != null
        ? { id: desiredOpponent2Id }
        : (opp2WasLiteralNull ? null : { id: null });

      // Step A: force-clear score/result artifacts from both slots.
      const before = await lockMatch(tx, currentId, eventId);
      if (!before) {
        throw new InternalError(`Match ${currentId} disappeared during reset`);
      }
      await bracketDb.mergeMatchOpponents(tx, before, scrubOpponent1, scrubOpponent2, Status.Waiting);

      // Step B: restore canonical replay participants for this match.
      const scrubbed = (await lockMatch(tx, currentId, eventId))!;
      await bracketDb.mergeMatchOpponents(tx, scrubbed, restoreOpponent1, restoreOpponent2, Status.Waiting);
    }

    await bracketDb.deleteMatchFrames(tx, resetMatchIds);
    await clearScoreOverrides(tx, resetMatchIds);

    // Handle grand final: if the target is the first GF match, keep the reset
    // match archived until the replayed first GF determines whether it is needed.
    const matchWithGroup = await bracketDb.getMatchGroupInfo(tx, matchId);
    if (
      matchWithGroup &&
      matchWithGroup.group_number === GRAND_FINAL_GROUP_NUMBER &&
      matchWithGroup.round_number === FIRST_GF_ROUND_NUMBER
    ) {
      const secondGFMatch = await bracketDb.getSecondGrandFinalMatch(tx, matchWithGroup.group_id);
      if (secondGFMatch && secondGFMatch.status !== Status.Archived) {
        await releaseMatchLane(tx, eventId, secondGFMatch.id);
        await bracketDb.updateMatchStatus(tx, secondGFMatch.id, Status.Archived);
      }
    }

    await autoAssignLanesTx(tx, eventId);

    return { resetMatchIds, taintPlan };
  });

  logger.info('Match result reset', {
    userId: user.id,
    action: 'reset_match_result',
    eventId,
    targetMatchId: matchId,
    resetMatchIds,
    resetMatchCount: resetMatchIds.length,
    taintedSlotSummary: [...taintPlan.taintedSlotsByMatch.entries()]
      .sort(([a], [b]) => a - b)
      .map(([rewrittenMatchId, slots]) => ({
        matchId: rewrittenMatchId,
        slots: [...slots].sort(),
      })),
    rewrittenOrder: resetMatchIds,
    correctionWorkflow: {
      correctionReason: workflow?.correctionReason ?? null,
      winnerChangeVerified: workflow?.winnerChangeVerified ?? false,
      teamsNotified: workflow?.teamsNotified ?? false,
    },
    outcome: 'success',
  });

  return { resetMatchIds };
}

/**
 * Archive the grand final reset match and release its lane.
 * Called when double_grand_final is toggled off to reconcile bracket state.
 */
export async function archiveGrandFinalResetMatch(eventId: string): Promise<void> {
  const { pg } = await requireEventAdmin(eventId);

  await withTransaction(pg, async (tx) => {
    await lockEvent(tx, eventId);
    await archiveGrandFinalResetMatchTx(tx, eventId);
  });
}

/** Transactional core. Caller must hold the event advisory lock. */
export async function archiveGrandFinalResetMatchTx(tx: Tx, eventId: string): Promise<void> {
  const gfGroupId = await bracketDb.getGrandFinalGroupId(tx, eventId, GRAND_FINAL_GROUP_NUMBER);
  if (gfGroupId == null) return;

  const resetMatch = await bracketDb.getSecondGrandFinalMatch(tx, gfGroupId);
  if (!resetMatch || resetMatch.status === Status.Archived) return;

  await releaseMatchLane(tx, eventId, resetMatch.id);
  await bracketDb.updateMatchStatus(tx, resetMatch.id, Status.Archived);
}

function hasParticipantInSlot(opponent: unknown): boolean {
  if (!opponent || typeof opponent !== 'object') return false;
  const id = (opponent as { id?: number | null }).id;
  return id != null;
}

function getReenabledResetStatus(
  firstGrandFinalMatch: Match | undefined,
  resetMatch: Match
): number {
  const resetHasBothParticipants =
    hasParticipantInSlot(resetMatch.opponent1) &&
    hasParticipantInSlot(resetMatch.opponent2);
  const defaultResetStatus = resetHasBothParticipants ? Status.Ready : Status.Waiting;

  if (!firstGrandFinalMatch || firstGrandFinalMatch.status !== Status.Completed) {
    return defaultResetStatus;
  }

  const firstOpp1 = firstGrandFinalMatch.opponent1 as { result?: string } | null;
  const firstOpp2 = firstGrandFinalMatch.opponent2 as { result?: string } | null;
  if (firstOpp1?.result === 'win' && firstOpp2?.result === 'loss') {
    return Status.Archived;
  }

  if (firstOpp2?.result === 'win' && firstOpp1?.result === 'loss') {
    return defaultResetStatus;
  }

  return defaultResetStatus;
}

/**
 * Restore/reconcile the grand final reset match when double_grand_final is toggled on.
 */
export async function restoreGrandFinalResetMatch(eventId: string): Promise<void> {
  const { pg } = await requireEventAdmin(eventId);

  await withTransaction(pg, async (tx) => {
    await lockEvent(tx, eventId);
    await restoreGrandFinalResetMatchTx(tx, eventId);
  });
}

/** Transactional core. Caller must hold the event advisory lock. */
export async function restoreGrandFinalResetMatchTx(tx: Tx, eventId: string): Promise<void> {
  const context = await bracketDb.getBracketResetContext(tx, eventId);
  if (!context) return;

  const gfGroup = context.groups.find((g) => g.number === GRAND_FINAL_GROUP_NUMBER);
  if (!gfGroup) return;

  const gfRoundOne = context.rounds.find((r) => r.group_id === gfGroup.id && r.number === 1);
  const gfRoundTwo = context.rounds.find((r) => r.group_id === gfGroup.id && r.number === 2);
  if (!gfRoundTwo) return;

  const firstGrandFinalMatch = context.matches.find(
    (m) => m.round_id === gfRoundOne?.id && m.number === 1
  ) as unknown as Match | undefined;
  const resetMatch = context.matches.find(
    (m) => m.round_id === gfRoundTwo.id && m.number === 1
  ) as unknown as Match | undefined;
  if (!resetMatch) return;

  const desiredStatus = getReenabledResetStatus(firstGrandFinalMatch, resetMatch);
  if (resetMatch.status !== desiredStatus) {
    await bracketDb.updateMatchStatus(tx, Number(resetMatch.id), desiredStatus);
  }
}

export { Status } from 'brackets-model';
