import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { authorizeAccessCode, type AccessCodeEvent, type Db, type PrivilegedClient } from '@/lib/services/auth';
import {
  BadRequestError,
  NotFoundError,
  ForbiddenError,
} from '@/lib/errors';
import { completeMatch } from './match-completion';
import { recordFrameScores, type FrameScore } from './score-submission';
import { getPublicTeamFromParticipant, getTeamFromParticipant } from '@/lib/repositories/team-repository';
import { getEventBracketFrameCount, getEventScoringConfig } from '@/lib/repositories/event-repository';
import { getLaneLabelsForEvent, getLanesForEvent } from '@/lib/repositories/lane-repository';
import {
  getMatchesForScoringByEvent,
  getMatchForScoringById,
  updateMatchStatus,
  getMatchByIdAndEvent,
} from '@/lib/repositories/bracket-repository';
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
): Promise<{ event: PublicEventInfo; db: PrivilegedClient; pg: Db }> {
  const { event, db, pg } = await authorizeAccessCode(accessCode, { mode: 'bracket' });
  return { event: toPublicEventInfo(event), db, pg };
}

/**
 * Get event scoring context based on access code
 * Determines if event is in qualification or bracket mode
 */
export async function getEventScoringContext(accessCode: string) {
  const { event: eventCheck, db } = await authorizeAccessCode(accessCode);

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
      getMatchesForScoringInternal(db, event),
      getLanesForEvent(db, event.id),
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
  const { event, db } = await authorizeBracketScorer(accessCode);
  return getMatchesForScoringInternal(db, event);
}

async function getMatchesForScoringInternal(
  supabase: PrivilegedClient,
  event: PublicEventInfo
): Promise<PublicMatchInfo[]> {
  // Parallel: Get lanes and bracket matches simultaneously
  const [laneMap, bracketMatches] = await Promise.all([
    getLaneLabelsForEvent(supabase, event.id),
    getMatchesForScoringByEvent(supabase, event.id),
  ]);

  if (bracketMatches.length === 0) {
    return [];
  }

  // Parallel: Fetch all teams for all matches simultaneously
  const teamPromises = bracketMatches.flatMap((bm) => {
    const opponent1 = bm.opponent1 as { id?: number; score?: number } | null;
    const opponent2 = bm.opponent2 as { id?: number; score?: number } | null;
    return [
      getPublicTeamFromParticipant(supabase, opponent1?.id ?? null),
      getPublicTeamFromParticipant(supabase, opponent2?.id ?? null),
    ];
  });

  const teams = await Promise.all(teamPromises);

  // Build matches from results
  const matches: PublicMatchInfo[] = [];

  for (let i = 0; i < bracketMatches.length; i++) {
    const bm = bracketMatches[i];
    const team_one = teams[i * 2];
    const team_two = teams[i * 2 + 1];

    // Skip matches without both teams
    if (!team_one || !team_two) continue;

    const opponent1 = bm.opponent1 as { id?: number; score?: number } | null;
    const opponent2 = bm.opponent2 as { id?: number; score?: number } | null;

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
  const { event, db } = await authorizeBracketScorer(accessCode);
  return getMatchForScoringInternal(db, event, bracketMatchId);
}

async function getMatchForScoringInternal(
  supabase: PrivilegedClient,
  event: PublicEventInfo,
  bracketMatchId: number
): Promise<PublicMatchInfo> {
  // Parallel: Get lanes and bracket match simultaneously
  const [laneMap, bracketMatch] = await Promise.all([
    getLaneLabelsForEvent(supabase, event.id),
    getMatchForScoringById(supabase, bracketMatchId),
  ]);

  if (!bracketMatch) {
    throw new NotFoundError('Match not found');
  }

  if (bracketMatch.event_id !== event.id) {
    throw new ForbiddenError('Match does not belong to this event');
  }

  const opponent1 = bracketMatch.opponent1 as { id?: number; score?: number } | null;
  const opponent2 = bracketMatch.opponent2 as { id?: number; score?: number } | null;

  const [team_one, team_two] = await Promise.all([
    getPublicTeamFromParticipant(supabase, opponent1?.id ?? null),
    getPublicTeamFromParticipant(supabase, opponent2?.id ?? null),
  ]);

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
  const { event, db, pg } = await authorizeBracketScorer(accessCode);

  const { status } = await recordFrameScores(pg, {
    eventId: event.id,
    matchId: bracketMatchId,
    frameNumber,
    scores,
    scorer: 'public',
  });

  // Read back after commit (outside the transaction, so the match lock is short).
  const match = await getMatchForScoringInternal(db, event, bracketMatchId);
  return { ...match, status };
}

/**
 * Get bracket match with full details for public (anon) access.
 * Mirrors getBracketMatchWithDetails but uses the anon client (respects RLS).
 * The get_frame_results_for_match RPC is gated to events in 'bracket' status,
 * so frame data is only visible while bracket play is active.
 */
export async function getPublicMatchDetails(
  eventId: string,
  matchId: number
): Promise<PublicMatchDetails> {
  const supabase = await createClient();

  const [bracketMatch, bracketFrameCount, eventConfig] = await Promise.all([
    getMatchForScoringById(supabase, matchId),
    getEventBracketFrameCount(supabase, eventId),
    getEventScoringConfig(supabase, eventId),
  ]);

  if (!bracketMatch || bracketMatch.event_id !== eventId) {
    throw new NotFoundError('Match not found');
  }

  if (bracketFrameCount === null || !eventConfig) {
    throw new InternalError('Event scoring configuration not found');
  }

  const opponent1 = bracketMatch.opponent1 as OpponentData | null;
  const opponent2 = bracketMatch.opponent2 as OpponentData | null;

  const [team_one, team_two] = await Promise.all([
    getTeamFromParticipant(supabase, opponent1?.id ?? null),
    getTeamFromParticipant(supabase, opponent2?.id ?? null),
  ]);

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
  const { event, db: supabase } = await authorizeBracketScorer(accessCode);

  const bracketMatch = await getMatchByIdAndEvent(supabase, bracketMatchId, event.id);

  if (!bracketMatch) {
    throw new NotFoundError('Match not found');
  }

  if (bracketMatch.status === MatchStatus.Ready) {
    if (bracketMatch.lane_id === null) {
      throw new BadRequestError('Match has no lane assigned');
    }
    await updateMatchStatus(supabase, bracketMatchId, MatchStatus.Running);
  }
}

/**
 * Complete a match (public, access-code authenticated)
 */
export async function completeMatchPublic(
  accessCode: string,
  bracketMatchId: number
): Promise<PublicMatchInfo> {
  const { event, db: supabase, pg } = await authorizeBracketScorer(accessCode);

  // Pre-fetch for the response fallback below (and to 404 on a foreign match early).
  const match = await getMatchForScoringInternal(supabase, event, bracketMatchId);

  // Result (from the match's frames), bracket progression and lane release commit together.
  await completeMatch(pg, event.id, bracketMatchId);

  // Try to re-fetch the match for accurate data, but fall back to pre-fetched
  // data with updated status if the query times out (the client redirects
  // immediately anyway and doesn't use the response body)
  try {
    return await getMatchForScoringInternal(supabase, event, bracketMatchId);
  } catch (fetchError) {
    console.error('Failed to fetch updated match after completion:', fetchError);
    return {
      ...match,
      status: MatchStatus.Completed,
    };
  }
}
