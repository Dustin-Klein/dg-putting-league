import 'server-only';
import { BracketsManager, helpers } from 'brackets-manager';
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
import { logger } from '@/lib/utils/logger';
import {
  bracketStageExists,
  getBracketParticipants,
  linkParticipantsToTeams,
  setEventIdOnMatches,
  getMatchesByStageId,
  bulkUpdateMatchStatuses,
  getBracketStage,
  fetchBracketStructure,
  getParticipantsWithTeamIds,
  getMatchWithStage,
  getReadyMatchesByStageId,
  assignLaneToMatchRpc,
  getMatchForScoringById,
  getMatchForAdvancement,
  updateMatchWithOpponents,
  clearAllMatchOpponents,
  getBracketResetContext,
  deleteMatchFrames,
  getMatchWithGroupInfo,
  getSecondGrandFinalMatch,
  updateMatchStatus,
} from '@/lib/repositories/bracket-repository';
import type { BracketMatchForReset, BracketResetContext } from '@/lib/repositories/bracket-repository';
import { getFullTeamsForEvent, getPublicTeamsForEvent } from '@/lib/repositories/team-repository';
import { getLanesForEvent, resetAllLanesToIdle } from '@/lib/repositories/lane-repository';
import { getEventById } from '@/lib/repositories/event-repository';
import type { EventStatus } from '@/lib/types/event';
import type { BracketWithTeams } from '@/lib/types/bracket';

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
  const exists = await bracketStageExists(supabase, eventId);

  if (exists) {
    throw new BadRequestError('Bracket has already been created for this event');
  }

  // Get teams for seeding
  const teams = await getEventTeams(eventId);

  if (teams.length < 2) {
    throw new BadRequestError('At least 2 teams are required to create a bracket');
  }

  const storage = new SupabaseBracketStorage(supabase, eventId);
  const manager = new BracketsManager(storage);

  const sortedTeams = [...teams].sort((a, b) => (a.seed || 0) - (b.seed || 0));

  // brackets-manager requires participant count to be a power of 2
  const bracketSize = nextPowerOf2(sortedTeams.length);
  const seeding: (string | null)[] = sortedTeams.map((team) => team.pool_combo);

  // Fill remaining slots with BYEs
  while (seeding.length < bracketSize) {
    seeding.push(null);
  }

  await manager.create.stage({
    tournamentId: eventId as unknown as number,
    name: 'Double Elimination',
    type: 'double_elimination',
    seeding,
    settings: {
      grandFinal: event.double_grand_final ? 'double' : 'simple',
      seedOrdering: ['inner_outer'],
      balanceByes: true,
    },
  });

  const participants = await getBracketParticipants(supabase, eventId);

  if (participants.length > 0) {
    const mappings: Array<{ participantId: number; teamId: string }> = [];
    for (let i = 0; i < participants.length; i++) {
      const team = sortedTeams[i];
      if (team) {
        mappings.push({ participantId: participants[i].id, teamId: team.id });
      }
    }
    if (mappings.length > 0) {
      await linkParticipantsToTeams(supabase, mappings);
    }
  }

  const stage = await getBracketStage(supabase, eventId);

  if (stage) {
    await setEventIdOnMatches(supabase, stage.id, eventId);
  }

  await setInitialMatchesReady(supabase, eventId);

  return getBracket(eventId);
}

/**
 * Set initial matches (first round) to ready status
 */
async function setInitialMatchesReady(
  supabase: Awaited<ReturnType<typeof createClient>>,
  eventId: string
): Promise<void> {
  const stage = await getBracketStage(supabase, eventId);

  if (!stage) return;

  const matches = await getMatchesByStageId(supabase, stage.id);
  if (matches.length === 0) return;

  // Collect all match IDs that need Ready status
  const matchIdsToUpdate: number[] = [];
  for (const match of matches) {
    const opp1 = match.opponent1 as { id: number | null } | null;
    const opp2 = match.opponent2 as { id: number | null } | null;

    if (opp1?.id !== null && opp2?.id !== null) {
      matchIdsToUpdate.push(match.id);
    }
  }

  // Single bulk update
  if (matchIdsToUpdate.length > 0) {
    await bulkUpdateMatchStatuses(supabase, matchIdsToUpdate, Status.Ready);
  }
}

/**
 * Get public bracket data with teams and lanes
 */
export async function getPublicBracket(eventId: string): Promise<BracketWithTeams> {
  const supabase = await createClient();

  // Get event to check it exists and get status
  const event = await getEventById(supabase, eventId);

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
    getPublicTeamsForEvent(supabase, eventId),
    getLanesForEvent(supabase, eventId),
  ]);

  if (!bracketStructure) {
    throw new NotFoundError('Bracket not found for this event');
  }

  const { stage, groups, rounds, matches, participants } = bracketStructure;

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
      stage: stage as unknown as Stage,
      groups: groups as unknown as Group[],
      rounds: rounds as unknown as Round[],
      matches: matches as unknown as Match[],
      participants: participants as unknown as Participant[],
    },
    teams,
    participantTeamMap,
    lanes,
    laneMap,
    eventStatus: event.status,
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
}> {
  const { supabase } = await requireEventAdmin(eventId);

  const [bracket, teams, event, participantsWithTeams] = await Promise.all([
    getBracket(eventId),
    getEventTeams(eventId),
    getEventById(supabase, eventId),
    getParticipantsWithTeamIds(supabase, eventId),
  ]);

  const participantTeamMap: Record<number, Team> = {};

  for (const p of participantsWithTeams) {
    const team = teams.find((t) => t.id === p.team_id);
    if (team) {
      participantTeamMap[p.id] = team;
    }
  }

  return { bracket, teams, participantTeamMap, eventStatus: event?.status, accessCode: event?.access_code ?? undefined };
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

  const match = await getMatchWithStage(supabase, matchId);

  if (!match) {
    throw new NotFoundError('Match not found');
  }

  if (match.bracket_stage.tournament_id !== eventId) {
    throw new BadRequestError('Match does not belong to this event');
  }

  const storage = new SupabaseBracketStorage(supabase, eventId);
  const manager = new BracketsManager(storage);

  let result1: 'win' | 'loss' | 'draw' | undefined;
  let result2: 'win' | 'loss' | 'draw' | undefined;

  if (winnerId !== undefined) {
    const opp1 = match.opponent1;
    const opp2 = match.opponent2;

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

  await manager.update.match({
    id: matchId,
    opponent1: { score: opponent1Score, result: result1 },
    opponent2: { score: opponent2Score, result: result2 },
  });

  const updatedMatch = await getMatchForScoringById(supabase, matchId);

  if (!updatedMatch) {
    throw new InternalError('Failed to fetch updated match');
  }

  return updatedMatch as unknown as Match;
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
 * Assign a lane to a match using atomic RPC
 */
export async function assignLaneToMatch(
  eventId: string,
  matchId: number,
  laneId: string
): Promise<void> {
  const { supabase } = await requireEventAdmin(eventId);

  await assignLaneToMatchRpc(supabase, eventId, laneId, matchId);
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
  const { supabase } = await requireEventAdmin(eventId);

  const match = await getMatchForAdvancement(supabase, targetMatchId, eventId);

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
  const participants = await getBracketParticipants(supabase, eventId);
  const participant = participants.find((p) => p.id === participantId);

  if (!participant) {
    throw new BadRequestError('Participant not found in this event');
  }

  const newOpponent = { id: participantId };

  await updateMatchWithOpponents(
    supabase,
    targetMatchId,
    slot === 'opponent1' ? newOpponent : null,
    slot === 'opponent2' ? newOpponent : null,
    match.status
  );
}

/**
 * Remove a team from a match slot
 */
export async function removeTeamFromMatch(
  eventId: string,
  targetMatchId: number,
  slot: 'opponent1' | 'opponent2'
): Promise<void> {
  const { supabase, user } = await requireEventAdmin(eventId);

  const match = await getMatchForAdvancement(supabase, targetMatchId, eventId);

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

  await updateMatchWithOpponents(
    supabase,
    targetMatchId,
    slot === 'opponent1' ? emptyOpponent : null,
    slot === 'opponent2' ? emptyOpponent : null,
    match.status
  );

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
  const { supabase, user } = await requireEventAdmin(eventId);

  const stage = await getBracketStage(supabase, eventId);

  if (!stage) {
    throw new NotFoundError('Bracket not found for this event');
  }

  await clearAllMatchOpponents(supabase, stage.id);
  await resetAllLanesToIdle(supabase, eventId);

  logger.info('Bracket placements cleared', {
    userId: user.id,
    action: 'clear_bracket_placements',
    eventId,
    stageId: stage.id,
    outcome: 'success',
  });

  return getBracket(eventId);
}

/**
 * Find all matches that must be reset along with the target match.
 * Uses parent-child links (opponent.position) to find downstream matches.
 */
export function findMatchesToReset(
  targetMatch: BracketMatchForReset,
  allMatches: BracketMatchForReset[]
): BracketMatchForReset[] {
  const resettableStatuses = new Set([Status.Completed, Status.Running, Status.Archived, Status.Locked]);
  const matchById = new Map<number, BracketMatchForReset>(allMatches.map((m) => [m.id, m]));
  const visited = new Set<number>([targetMatch.id]);
  const depthByMatchId = new Map<number, number>([[targetMatch.id, 0]]);
  const cascadeMatchIds = new Set<number>();
  const queue: number[] = [targetMatch.id];

  const getParticipantIds = (match: BracketMatchForReset): Set<number> => {
    const ids = new Set<number>();
    const opp1Id = match.opponent1?.id;
    const opp2Id = match.opponent2?.id;
    if (opp1Id != null) ids.add(opp1Id);
    if (opp2Id != null) ids.add(opp2Id);
    return ids;
  };

  const normalizePosition = (position: unknown): number | null => {
    if (position == null) return null;
    const parsed = Number(position);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const pointsToCurrentMatch = (position: unknown, currentMatch: BracketMatchForReset | undefined): boolean => {
    if (!currentMatch) return false;
    const normalized = normalizePosition(position);
    if (normalized == null) return false;
    return normalized === currentMatch.id || normalized === currentMatch.number;
  };

  while (queue.length > 0) {
    const currentMatchId = queue.shift()!;
    const currentDepth = depthByMatchId.get(currentMatchId) ?? 0;
    const currentMatch = matchById.get(currentMatchId);
    const currentParticipantIds = currentMatch ? getParticipantIds(currentMatch) : new Set<number>();

    for (const match of allMatches) {
      if (visited.has(match.id)) continue;

      const isDirectChildByPosition =
        pointsToCurrentMatch(match.opponent1?.position, currentMatch) ||
        pointsToCurrentMatch(match.opponent2?.position, currentMatch);
      const hasMissingPosition =
        match.opponent1?.position == null || match.opponent2?.position == null;

      // Fallback for historical/manual records where position metadata is missing.
      // Limit this fallback to locked matches to avoid over-cascading unrelated paths.
      const isPotentialChildByParticipant =
        hasMissingPosition &&
        match.status === Status.Locked &&
        currentParticipantIds.size > 0 &&
        ((match.opponent1?.id != null && currentParticipantIds.has(match.opponent1.id)) ||
          (match.opponent2?.id != null && currentParticipantIds.has(match.opponent2.id)));

      if (!isDirectChildByPosition && !isPotentialChildByParticipant) continue;

      visited.add(match.id);
      depthByMatchId.set(match.id, currentDepth + 1);
      queue.push(match.id);

      if (resettableStatuses.has(match.status)) {
        cascadeMatchIds.add(match.id);
      }
    }
  }

  const cascadeMatches = allMatches.filter((m) => cascadeMatchIds.has(m.id));
  // Reset deepest descendants first so parent resets won't be blocked by locked children.
  cascadeMatches.sort((a, b) => {
    const depthDiff = (depthByMatchId.get(b.id) ?? 0) - (depthByMatchId.get(a.id) ?? 0);
    if (depthDiff !== 0) return depthDiff;
    return b.round_id - a.round_id;
  });

  return cascadeMatches;
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
  const { supabase, user } = await requireEventAdmin(eventId);

  const context = await getBracketResetContext(supabase, eventId);
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

  const storage = new SupabaseBracketStorage(supabase, eventId);
  const manager = new BracketsManager(storage);
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
  const resetOperations = resetMatchIds.map((currentId) => {
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

    return {
      matchId: currentId,
      scrubOpponent1,
      scrubOpponent2,
      restoreOpponent1,
      restoreOpponent2,
      rollbackOpponent1: baselineMatch.opponent1,
      rollbackOpponent2: baselineMatch.opponent2,
      rollbackStatus: baselineMatch.status,
    };
  });
  const operationByMatchId = new Map(resetOperations.map((operation) => [operation.matchId, operation]));
  const rewrittenMatchIds: number[] = [];

  try {
    for (const operation of resetOperations) {
      // Step A: force-clear score/result artifacts from both slots.
      await updateMatchWithOpponents(
        supabase,
        operation.matchId,
        operation.scrubOpponent1,
        operation.scrubOpponent2,
        Status.Waiting
      );

      // Step B: restore canonical replay participants for this match.
      await updateMatchWithOpponents(
        supabase,
        operation.matchId,
        operation.restoreOpponent1,
        operation.restoreOpponent2,
        Status.Waiting
      );

      rewrittenMatchIds.push(operation.matchId);
    }
  } catch (error) {
    const rollbackFailures: Array<{ matchId: number; error: string }> = [];
    for (const rewrittenMatchId of [...rewrittenMatchIds].reverse()) {
      const operation = operationByMatchId.get(rewrittenMatchId);
      if (!operation) continue;
      try {
        await updateMatchWithOpponents(
          supabase,
          operation.matchId,
          operation.rollbackOpponent1,
          operation.rollbackOpponent2,
          operation.rollbackStatus
        );
      } catch (rollbackError) {
        rollbackFailures.push({
          matchId: operation.matchId,
          error: rollbackError instanceof Error ? rollbackError.message : String(rollbackError),
        });
      }
    }

    logger.error('Match result reset failed during rewrite phase', {
      userId: user.id,
      action: 'reset_match_result',
      eventId,
      targetMatchId: matchId,
      resetMatchIds,
      rewrittenMatchIds,
      rollbackFailures,
      outcome: 'failure',
      error: error instanceof Error ? error.message : String(error),
    });

    throw new InternalError(
      'Failed while rewriting reset matches; no frame deletions were attempted. Retry is safe.'
    );
  }

  try {
    for (const currentId of resetMatchIds) {
      await deleteMatchFrames(supabase, currentId);
    }
  } catch (error) {
    logger.error('Match result reset failed during frame deletion phase', {
      userId: user.id,
      action: 'reset_match_result',
      eventId,
      targetMatchId: matchId,
      resetMatchIds,
      rewrittenMatchIds,
      outcome: 'failure',
      error: error instanceof Error ? error.message : String(error),
    });
    throw new InternalError(
      'Reset rewrites were applied but frame deletion only partially completed. Retry the reset to finish cleanup.'
    );
  }

  // Handle grand final: if the target is the first GF match, keep the reset
  // match archived until the replayed first GF determines whether it is needed.
  const matchWithGroup = await getMatchWithGroupInfo(supabase, matchId);
  if (matchWithGroup) {
    const groupNumber = matchWithGroup.round?.group?.number;
    const roundNumber = matchWithGroup.round?.number;
    if (groupNumber === GRAND_FINAL_GROUP_NUMBER && roundNumber === FIRST_GF_ROUND_NUMBER) {
      const secondGFMatch = await getSecondGrandFinalMatch(supabase, matchWithGroup.group_id);
      if (secondGFMatch && secondGFMatch.status !== Status.Archived) {
        await updateMatchStatus(supabase, secondGFMatch.id, Status.Archived);
      }
    }
  }

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

export { Status } from 'brackets-model';
