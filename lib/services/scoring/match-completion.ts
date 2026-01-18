import { BracketsManager } from 'brackets-manager';
import { createClient } from '@/lib/supabase/server';
import {
  SupabaseBracketStorage,
  getMatchWithGroupInfo,
  getSecondGrandFinalMatch,
  archiveMatch,
  updateMatchStatus,
} from '@/lib/repositories/bracket-repository';
import { MatchStatus } from '@/lib/types/bracket';
import { BadRequestError, InternalError } from '@/lib/errors';
import type { MatchScores } from '@/lib/types/scoring';
import type { SupabaseClient } from '@supabase/supabase-js';

export type { MatchScores } from '@/lib/types/scoring';

/**
 * Complete a bracket match and update bracket progression
 *
 * This is the core match completion logic used by both admin and public scoring.
 * It uses brackets-manager to handle bracket progression.
 */
export async function completeMatch(
  supabase: Awaited<ReturnType<typeof createClient>>,
  eventId: string,
  bracketMatchId: number,
  scores: MatchScores
): Promise<void> {
  const { team1Score, team2Score } = scores;

  if (team1Score === team2Score) {
    throw new BadRequestError('Match cannot be completed with a tied score');
  }

  const team1Won = team1Score > team2Score;

  const storage = new SupabaseBracketStorage(supabase, eventId);
  const manager = new BracketsManager(storage);

  try {
    await manager.update.match({
      id: bracketMatchId,
      opponent1: {
        score: team1Score,
        result: team1Won ? 'win' : 'loss',
      },
      opponent2: {
        score: team2Score,
        result: team1Won ? 'loss' : 'win',
      },
    });

    // Handle grand final special case: if WB champion wins first GF match, archive the reset match
    await handleGrandFinalCompletion(supabase, bracketMatchId, team1Won);
  } catch (bracketError) {
    console.error('Failed to update bracket match:', bracketError);
    throw new InternalError(`Failed to complete match: ${bracketError}`);
  }
}

const GRAND_FINAL_GROUP_NUMBER = 3;
const FIRST_GF_ROUND_NUMBER = 1;

/**
 * Handle grand final completion: manage the second grand final (reset match)
 * based on the outcome of the first grand final match.
 *
 * In double elimination grand finals:
 * - opponent1 is the WB champion (0 losses)
 * - opponent2 is the LB champion (1 loss)
 * - If opponent1 wins → tournament over, archive reset match
 * - If opponent2 wins → reset match is needed, ensure it's Ready
 *
 * This function handles both initial completion and score corrections.
 */
export async function handleGrandFinalCompletion(
  supabase: SupabaseClient,
  completedMatchId: number,
  opponent1Won: boolean
): Promise<void> {
  const match = await getMatchWithGroupInfo(supabase, completedMatchId);
  if (!match) return;

  // Check if this is a grand final match (group number 3 in double elimination)
  const groupNumber = match.round?.group?.number;
  const roundNumber = match.round?.number;

  if (groupNumber !== GRAND_FINAL_GROUP_NUMBER) return;
  if (roundNumber !== FIRST_GF_ROUND_NUMBER) return;

  // This is the first grand final match - find the reset match
  const secondGFMatch = await getSecondGrandFinalMatch(supabase, match.group_id);
  if (!secondGFMatch) return;

  if (opponent1Won) {
    // WB champion won - archive the reset match if not already archived
    if (secondGFMatch.status !== MatchStatus.Archived) {
      await archiveMatch(supabase, secondGFMatch.id);
    }
  } else {
    // LB champion won - ensure the reset match is playable
    if (secondGFMatch.status === MatchStatus.Archived) {
      await updateMatchStatus(supabase, secondGFMatch.id, MatchStatus.Ready);
    }
  }
}