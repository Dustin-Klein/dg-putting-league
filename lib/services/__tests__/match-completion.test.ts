/**
 * Match Completion Tests
 *
 * completeMatch runs with the privileged (RLS-bypassing) client, so it must
 * verify the match belongs to the authorized event before writing.
 */

import { BadRequestError, NotFoundError } from '@/lib/errors';
import { createMockSupabaseClient } from './test-utils';

const mockUpdateMatch = jest.fn();

jest.mock('brackets-manager', () => ({
  BracketsManager: jest.fn().mockImplementation(() => ({
    update: { match: mockUpdateMatch },
  })),
}));

jest.mock('@/lib/repositories/bracket-repository', () => ({
  SupabaseBracketStorage: jest.fn(),
  getMatchByIdAndEvent: jest.fn(),
  getMatchWithGroupInfo: jest.fn(),
  getSecondGrandFinalMatch: jest.fn(),
  archiveMatch: jest.fn(),
  updateMatchStatus: jest.fn(),
}));

jest.mock('@/lib/repositories/event-repository', () => ({
  getEventById: jest.fn(),
}));

import {
  getMatchByIdAndEvent,
  getMatchWithGroupInfo,
} from '@/lib/repositories/bracket-repository';
import { getEventById } from '@/lib/repositories/event-repository';
import { completeMatch } from '../scoring/match-completion';

describe('completeMatch', () => {
  const db = createMockSupabaseClient() as unknown as Parameters<typeof completeMatch>[0];

  beforeEach(() => {
    jest.clearAllMocks();
    (getEventById as jest.Mock).mockResolvedValue({ double_grand_final: true });
    (getMatchWithGroupInfo as jest.Mock).mockResolvedValue(null);
  });

  it('refuses to complete a match that is not in the authorized event', async () => {
    (getMatchByIdAndEvent as jest.Mock).mockResolvedValue(null);

    await expect(
      completeMatch(db, 'event-a', 42, { team1Score: 5, team2Score: 3 })
    ).rejects.toThrow(NotFoundError);

    expect(getMatchByIdAndEvent).toHaveBeenCalledWith(db, 42, 'event-a');
    expect(mockUpdateMatch).not.toHaveBeenCalled();
  });

  it('updates the bracket when the match belongs to the event', async () => {
    (getMatchByIdAndEvent as jest.Mock).mockResolvedValue({ id: 42, event_id: 'event-a' });

    await completeMatch(db, 'event-a', 42, { team1Score: 5, team2Score: 3 });

    expect(mockUpdateMatch).toHaveBeenCalledWith({
      id: 42,
      opponent1: { score: 5, result: 'win' },
      opponent2: { score: 3, result: 'loss' },
    });
  });

  it('rejects tied scores before touching the database', async () => {
    await expect(
      completeMatch(db, 'event-a', 42, { team1Score: 4, team2Score: 4 })
    ).rejects.toThrow(BadRequestError);

    expect(getMatchByIdAndEvent).not.toHaveBeenCalled();
  });
});
