import { BracketsManager } from 'brackets-manager';
import { createClient } from '@/lib/supabase/server';
import { SupabaseBracketStorage } from '@/lib/repositories/bracket-repository';
import { BadRequestError, InternalError } from '@/lib/errors';
import type { MatchScores } from '@/lib/types/scoring';

// Re-export for consumers
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

  // Use brackets-manager to update the match (handles bracket progression)
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
  } catch (bracketError) {
    console.error('Failed to update bracket match:', bracketError);
    throw new InternalError(`Failed to complete match: ${bracketError}`);
  }
}
