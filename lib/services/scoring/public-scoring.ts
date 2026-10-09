import 'server-only';
import { authorizeAccessCode, authorizeEventView, type AccessCodeEvent, type Db } from '@/lib/services/auth';
import {
  BadRequestError,
  NotFoundError,
  ForbiddenError,
} from '@/lib/errors';
import { completeMatch } from './match-completion';
import { recordFrameScores, type FrameScore } from './score-submission';
import { getPublicTeamsByParticipantIds, getTeamsByParticipantIds } from '@/lib/repositories/team-repository.db';
import { getEventBracketFrameCount, getEventScoringConfig } from '@/lib/repositories/event-repository.db';
import { getLaneLabelsForEvent, getLanesForEvent } from '@/lib/repositories/lane-repository.db';
import {
  getMatchesForScoringByEvent,
  getMatchForScoringById,
  startReadyMatch,
} from '@/lib/repositories/bracket-repository.db';
import { lockMatch, withTransaction } from '@/lib/db/tx';
import type { PublicMatchDetails, OpponentData } from '@/lib/types/scoring';
import { InternalError } from '@/lib/errors';
import {
  validateQualificationAccessCode,
  getPlayersForQualification,
} from '@/lib/services/qualification';
import type {
  PublicEventInfo,
  PublicMatchInfo,
  ScoringLane,
} from '@/lib/types/scoring';
import { MatchStatus } from '@/lib/types/bracket';

// Re-export types for consumers
export type {
  PublicEventInfo,
  PublicMatchInfo,
  PublicTeamInfo,
  PublicPlayerInfo,
  PublicFrameInfo,
  PublicFrameResult,
  ScoringLane,
} from '@/lib/types/scoring';

function toPublicEventInfo(event: AccessCodeEvent): PublicEventInfo {
  return {
    id: event.id,
    event_date: event.event_date,
    location: event.location,
    lane_count: event.lane_count,
    bonus_point_enabled: event.bonus_point_enabled,
    bracket_frame_count: event.bracket_frame_count,
    status: event.status,
  };
}

/**
 * Authorize a bracket scorer by access code.
 * Returns the event and the privileged client to use for this request.
 */
async function authorizeBracketScorer(
  accessCode: string
): Promise<{ event: PublicEventInfo; pg: Db }> {
  const { event, pg } = await authorizeAccessCode(accessCode, { mode: 'bracket' });
  return { event: toPublicEventInfo(event), pg };
}

/**
 * Get event scoring context based on access code
 * Determines if event is in qualification or bracket mode
 */
export async function getEventScoringContext(accessCode: string) {
  const { event: eventCheck, pg } = await authorizeAccessCode(accessCode);

  // Handle qualification mode
  if (eventCheck.status === 'pre-bracket' && eventCheck.qualification_round_enabled) {
    const event = await validateQualificationAccessCode(accessCode);
    const players = await getPlayersForQualification(accessCode);

    return {
      mode: 'qualification' as const,
      event,
      players,
    };
  }

  // Handle bracket mode
  if (eventCheck.status === 'bracket') {
    const event = toPublicEventInfo(eventCheck);
    const [matches, allLanes] = await Promise.all([
      getMatchesForScoringInternal(pg, event),
      getLanesForEvent(pg, event.id),
    ]);

    const lanes: ScoringLane[] = allLanes.map(l => ({ id: l.id, label: l.label }));

    return {
      mode: 'bracket' as const,
      event,
      matches,
      lanes,
    };
  }

  // Event is not in a scoreable state
  throw new BadRequestError('Event is not accepting scores at this time');
}

/**
 * Validate access code and get event info
 * @param accessCode - The event access code
 */
export async function validateAccessCode(accessCode: string): Promise<PublicEventInfo> {
  const { event } = await authorizeBracketScorer(accessCode);
  return event;
}


/**
 * Get matches ready for scoring (status = ready or in_progress)
 */
export async function getMatchesForScoring(accessCode: string): Promise<PublicMatchInfo[]> {
  const { event, pg } = await authorizeBracketScorer(accessCode);
  return getMatchesForScoringInternal(pg, event);
}

async function getMatchesForScoringInternal(
  pg: Db,
  event: PublicEventInfo
): Promise<PublicMatchInfo[]> {
  // Parallel: Get lanes and bracket matches simultaneously
  const [laneMap, bracketMatches] = await Promise.all([
    getLaneLabelsForEvent(pg, event.id),
    getMatchesForScoringByEvent(pg, event.id),
  ]);

  if (bracketMatches.length === 0) {
    return [];
  }

  const participantIds = bracketMatches.flatMap((bm) => {
    const opponent1 = bm.opponent1 as { id?: number; score?: number } | null;
    const opponent2 = bm.opponent2 as { id?: number; score?: number } | null;
    return [opponent1?.id, opponent2?.id].filter((id): id is number => id !== undefined);
  });
  const teams = await getPublicTeamsByParticipantIds(pg, event.id, participantIds);

  // Build matches from results
  const matches: PublicMatchInfo[] = [];

  for (let i = 0; i < bracketMatches.length; i++) {
    const bm = bracketMatches[i];
    const opponent1 = bm.opponent1 as { id?: number; score?: number } | null;
    const opponent2 = bm.opponent2 as { id?: number; score?: number } | null;
    const team_one = opponent1?.id === undefined ? null : teams.get(opponent1.id) ?? null;
    const team_two = opponent2?.id === undefined ? null : teams.get(opponent2.id) ?? null;
    if (!team_one || !team_two) continue;

    matches.push({
      id: bm.id,
      round_id: bm.round_id,
      number: bm.number,
      status: bm.status,
      lane_id: bm.lane_id,
      lane_label: bm.lane_id ? laneMap[bm.lane_id] || null : null,
      team_one,
      team_two,
      team_one_score: opponent1?.score ?? 0,
      team_two_score: opponent2?.score ?? 0,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      frames: ((bm.frames || []) as any[]).sort((a, b) => a.frame_number - b.frame_number),
    });
  }

  return matches;
}

/**
 * Get a single match for scoring
 */
export async function getMatchForScoring(
  accessCode: string,
  bracketMatchId: number
): Promise<PublicMatchInfo> {
  const { event, pg } = await authorizeBracketScorer(accessCode);
  return getMatchForScoringInternal(pg, event, bracketMatchId);
}

async function getMatchForScoringInternal(
  pg: Db,
  event: PublicEventInfo,
  bracketMatchId: number
): Promise<PublicMatchInfo> {
  // Parallel: Get lanes and bracket match simultaneously
  const [laneMap, bracketMatch] = await Promise.all([
    getLaneLabelsForEvent(pg, event.id),
    getMatchForScoringById(pg, bracketMatchId),
  ]);

  if (!bracketMatch) {
    throw new NotFoundError('Match not found');
  }

  if (bracketMatch.event_id !== event.id) {
    throw new ForbiddenError('Match does not belong to this event');
  }

  const opponent1 = bracketMatch.opponent1 as { id?: number; score?: number } | null;
  const opponent2 = bracketMatch.opponent2 as { id?: number; score?: number } | null;

  const teams = await getPublicTeamsByParticipantIds(
    pg,
    event.id,
    [opponent1?.id, opponent2?.id].filter((id): id is number => id !== undefined)
  );
  const team_one = opponent1?.id === undefined ? null : teams.get(opponent1.id) ?? null;
  const team_two = opponent2?.id === undefined ? null : teams.get(opponent2.id) ?? null;

  if (!team_one || !team_two) {
    throw new NotFoundError('Match teams not found');
  }

  return {
    id: bracketMatch.id,
    round_id: bracketMatch.round_id,
    number: bracketMatch.number,
    status: bracketMatch.status,
    lane_id: bracketMatch.lane_id,
    lane_label: bracketMatch.lane_id ? laneMap[bracketMatch.lane_id] || null : null,
    team_one,
    team_two,
    team_one_score: opponent1?.score ?? 0,
    team_two_score: opponent2?.score ?? 0,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    frames: ((bracketMatch.frames || []) as any[]).sort((a, b) => a.frame_number - b.frame_number),
  };
}

/**
 * Record a score for a player in a frame (public, access-code authenticated)
 */
export async function recordScore(
  accessCode: string,
  bracketMatchId: number,
  frameNumber: number,
  eventPlayerId: string,
  puttsMade: number
): Promise<void> {
  const { event, pg } = await authorizeBracketScorer(accessCode);
  await recordFrameScores(pg, {
    eventId: event.id,
    matchId: bracketMatchId,
    frameNumber,
    scores: [{ event_player_id: eventPlayerId, putts_made: puttsMade }],
    scorer: 'public',
  });
}

/**
 * Record a score and return updated match (combined operation with shared client)
 * This avoids creating two separate clients and duplicating validation
 */
export async function recordScoreAndGetMatch(
  accessCode: string,
  bracketMatchId: number,
  frameNumber: number,
  eventPlayerId: string,
  puttsMade: number
): Promise<PublicMatchInfo> {
  return batchRecordScoresAndGetMatch(accessCode, bracketMatchId, frameNumber, [
    { event_player_id: eventPlayerId, putts_made: puttsMade },
  ]);
}

/**
 * Input for a single score in a batch operation
 */
export type BatchScoreInput = FrameScore;

/**
 * Record multiple scores for a single frame and return updated match
 * This reduces API calls by batching all frame scores into one request
 */
export async function batchRecordScoresAndGetMatch(
  accessCode: string,
  bracketMatchId: number,
  frameNumber: number,
  scores: BatchScoreInput[]
): Promise<PublicMatchInfo> {
  const { event, pg } = await authorizeBracketScorer(accessCode);

  const { status } = await recordFrameScores(pg, {
    eventId: event.id,
    matchId: bracketMatchId,
    frameNumber,
    scores,
    scorer: 'public',
  });

  // Read back after commit (outside the transaction, so the match lock is short).
  const match = await getMatchForScoringInternal(pg, event, bracketMatchId);
  return { ...match, status };
}

/**
 * Get bracket match with full details for public (anon) access.
 * Mirrors getBracketMatchWithDetails after an explicit bracket visibility check.
 * Bracket authorization preserves the old RPC's visibility gate for frame data.
 */
export async function getPublicMatchDetails(
  eventId: string,
  matchId: number
): Promise<PublicMatchDetails> {
  const { pg } = await authorizeEventView(eventId, 'bracket');
  const [bracketMatch, bracketFrameCount, eventConfig] = await Promise.all([
    getMatchForScoringById(pg, matchId),
    getEventBracketFrameCount(pg, eventId),
    getEventScoringConfig(pg, eventId),
  ]);

  if (!bracketMatch || bracketMatch.event_id !== eventId) {
    throw new NotFoundError('Match not found');
  }

  if (bracketFrameCount === null || !eventConfig) {
    throw new InternalError('Event scoring configuration not found');
  }

  const opponent1 = bracketMatch.opponent1 as OpponentData | null;
  const opponent2 = bracketMatch.opponent2 as OpponentData | null;

  const teams = await getTeamsByParticipantIds(
    pg,
    eventId,
    [opponent1?.id, opponent2?.id].filter((id): id is number => id !== null && id !== undefined)
  );
  const team_one = opponent1?.id == null ? null : teams.get(opponent1.id) ?? null;
  const team_two = opponent2?.id == null ? null : teams.get(opponent2.id) ?? null;

  return {
    id: bracketMatch.id,
    event_id: bracketMatch.event_id,
    round_id: bracketMatch.round_id,
    number: bracketMatch.number,
    status: bracketMatch.status,
    lane_id: bracketMatch.lane_id,
    opponent1,
    opponent2,
    team_one,
    team_two,
    frames: bracketMatch.frames?.sort((a, b) => a.frame_number - b.frame_number) ?? [],
    bracket_frame_count: bracketFrameCount,
    bonus_point_enabled: eventConfig.bonus_point_enabled,
  };
}

/**
 * Start a match (transition Ready → Running) when public scorer begins scoring.
 * Idempotent: no-op if match is already Running.
 */
export async function startMatchPublic(
  accessCode: string,
  bracketMatchId: number
): Promise<void> {
  const { event, pg } = await authorizeBracketScorer(accessCode);
  await withTransaction(pg, async (tx) => {
    const match = await lockMatch(tx, bracketMatchId, event.id);
    if (!match) throw new NotFoundError('Match not found');
    if (match.status !== MatchStatus.Ready) return;
    if (match.lane_id === null) throw new BadRequestError('Match has no lane assigned');
    await startReadyMatch(tx, bracketMatchId, event.id);
  });
}

/**
 * Complete a match (public, access-code authenticated)
 */
export async function completeMatchPublic(
  accessCode: string,
  bracketMatchId: number
): Promise<PublicMatchInfo> {
  const { event, pg } = await authorizeBracketScorer(accessCode);

  // Pre-fetch for the response fallback below (and to 404 on a foreign match early).
  const match = await getMatchForScoringInternal(pg, event, bracketMatchId);

  // Result (from the match's frames), bracket progression and lane release commit together.
  await completeMatch(pg, event.id, bracketMatchId, undefined, { requireRegulationFrames: true });

  // Try to re-fetch the match for accurate data, but fall back to pre-fetched
  // data with updated status if the query times out (the client redirects
  // immediately anyway and doesn't use the response body)
  try {
    return await getMatchForScoringInternal(pg, event, bracketMatchId);
  } catch (fetchError) {
    console.error('Failed to fetch updated match after completion:', fetchError);
    return {
      ...match,
      status: MatchStatus.Completed,
    };
  }
}
