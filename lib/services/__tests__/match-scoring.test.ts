
import {
  createMockSupabaseClient,
  MockSupabaseClient,
} from './test-utils';

// Mock dependencies
jest.mock('@/lib/services/event', () => ({
  requireEventAdmin: jest.fn(),
}));

jest.mock('@/lib/repositories/event-repository', () => ({
  getEventScoringConfig: jest.fn(),
  getEventBracketFrameCount: jest.fn(),
}));

jest.mock('@/lib/repositories/bracket-repository', () => ({
  getMatchByIdAndEvent: jest.fn(),
  getMatchWithOpponents: jest.fn(),
  updateMatchOpponentScores: jest.fn(),
  updateMatchStatus: jest.fn(),
  getMatchForScoringById: jest.fn(),
}));

jest.mock('@/lib/repositories/frame-repository', () => ({
  getOrCreateFrame: jest.fn(),
  getOrCreateFrameWithResults: jest.fn(),
  getFrameWithBracketMatch: jest.fn(),
  upsertFrameResult: jest.fn(),
  upsertFrameResultAtomic: jest.fn(),
  getMatchFrame: jest.fn(),
}));

jest.mock('@/lib/repositories/team-repository', () => ({
  getTeamFromParticipant: jest.fn(),
  getTeamIdsFromParticipants: jest.fn().mockResolvedValue(['team-1', 'team-2']),
  verifyPlayerInTeams: jest.fn().mockResolvedValue(true),
}));

import { requireEventAdmin } from '@/lib/services/event';
import { recordScoreAdmin } from '../scoring/match-scoring';

describe('Match Scoring Service', () => {
  let mockSupabase: MockSupabaseClient;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSupabase = createMockSupabaseClient();
    (requireEventAdmin as jest.Mock).mockResolvedValue({ supabase: mockSupabase });
  });

  describe('recordScoreAdmin - Input Validation', () => {
    const eventId = 'event-123';
    const bracketMatchId = 1;
    const eventPlayerId = 'player-123';
    const puttsMade = 2;

    it('should throw BadRequestError if frameNumber is negative', async () => {
      await expect(
        recordScoreAdmin(eventId, bracketMatchId, -1, eventPlayerId, puttsMade)
      ).rejects.toThrow('Frame number must be a positive integer');
    });

    it('should throw BadRequestError if frameNumber is zero', async () => {
      await expect(
        recordScoreAdmin(eventId, bracketMatchId, 0, eventPlayerId, puttsMade)
      ).rejects.toThrow('Frame number must be a positive integer');
    });

    it('should throw BadRequestError if frameNumber is not an integer', async () => {
      await expect(
        recordScoreAdmin(eventId, bracketMatchId, 1.5, eventPlayerId, puttsMade)
      ).rejects.toThrow('Frame number must be a positive integer');
    });

    it('should throw BadRequestError if frameNumber is too high', async () => {
      await expect(
        recordScoreAdmin(eventId, bracketMatchId, 100, eventPlayerId, puttsMade)
      ).rejects.toThrow('Frame number exceeds maximum allowed limit');
    });

    it('should NOT throw validation error if frameNumber is valid', async () => {
        // We expect this to fail later in the function because we haven't mocked everything perfectly,
        // but we want to ensure it passes the validation check.
        
        (requireEventAdmin as jest.Mock).mockResolvedValue({ supabase: mockSupabase });
        
        try {
            await recordScoreAdmin(eventId, bracketMatchId, 1, eventPlayerId, puttsMade);
        } catch (error) {
            expect((error as Error).message).not.toContain('Frame number');
        }
    });
  });
});
