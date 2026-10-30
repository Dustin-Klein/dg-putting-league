import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import QualificationScoringPage, { clearSentLocalScores } from '../page';

const push = jest.fn();
const toast = jest.fn();
const router = { push };

jest.mock('next/navigation', () => ({
  useRouter: () => router,
}));

jest.mock('@/components/ui/use-toast', () => ({
  useToast: () => ({ toast }),
}));

const getItemMock = jest.fn<string | null, [string]>(() => null);

const sessionStorageMock = (() => {
  let store: Record<string, string> = {};

  return {
    getItem: getItemMock,
    setItem: jest.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: jest.fn((key: string) => {
      delete store[key];
    }),
    clear: () => {
      store = {};
    },
  };
})();

Object.defineProperty(window, 'sessionStorage', {
  value: sessionStorageMock,
});

function createBatchResponse() {
  return {
    event: {
      id: 'event-1',
      event_date: '2026-03-15',
      location: 'Test Venue',
      bonus_point_enabled: true,
    },
    round: {
      id: 'round-1',
      frame_count: 3,
    },
    players: [
      {
        event_player_id: 'player-1',
        player_id: 'player-a',
        full_name: 'Player One',
        nickname: null,
        player_number: 12,
        frames_completed: 0,
        total_frames_required: 3,
        total_points: 0,
        is_complete: false,
        frames: [],
      },
      {
        event_player_id: 'player-2',
        player_id: 'player-b',
        full_name: 'Player Two',
        nickname: null,
        player_number: 18,
        frames_completed: 1,
        total_frames_required: 3,
        total_points: 2,
        is_complete: false,
        frames: [
          {
            id: 'frame-1-player-2',
            frame_number: 1,
            putts_made: 2,
            points_earned: 2,
          },
        ],
      },
    ],
  };
}

describe('QualificationScoringPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    sessionStorageMock.clear();
    getItemMock.mockImplementation((key: string): string | null => {
      if (key === 'scoring_access_code') {
        return 'code-123';
      }

      if (key === 'qualification_selected_players') {
        return JSON.stringify(['player-1', 'player-2']);
      }

      return null;
    });
  });

  it('advances through scoring and opens the review page after all frames are complete', async () => {
    const reviewBatchResponse = {
      event: {
        id: 'event-1',
        event_date: '2026-03-15',
        location: 'Test Venue',
        bonus_point_enabled: true,
      },
      round: {
        id: 'round-1',
        frame_count: 1,
      },
      players: [
        {
          event_player_id: 'player-1',
          player_id: 'player-a',
          full_name: 'Player One',
          nickname: null,
          player_number: 12,
          frames_completed: 0,
          total_frames_required: 1,
          total_points: 0,
          is_complete: false,
          frames: [],
        },
        {
          event_player_id: 'player-2',
          player_id: 'player-b',
          full_name: 'Player Two',
          nickname: null,
          player_number: 18,
          frames_completed: 0,
          total_frames_required: 1,
          total_points: 0,
          is_complete: false,
          frames: [],
        },
      ],
    };

    const fetchMock = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url === '/api/score/qualification/batch') {
        return {
          ok: true,
          json: async () => reviewBatchResponse,
        };
      }

      if (url === '/api/score/qualification/frames') {
        return {
          ok: true,
          json: async () => ({
            results: [
              {
                frame: { id: 'frame-1-player-1', frame_number: 1, putts_made: 3, points_earned: 4 },
                player: {
                  event_player_id: 'player-1',
                  player_id: 'player-a',
                  full_name: 'Player One',
                  nickname: null,
                  player_number: 12,
                  frames_completed: 1,
                  total_frames_required: 1,
                  total_points: 4,
                  is_complete: true,
                },
              },
              {
                frame: { id: 'frame-1-player-2', frame_number: 1, putts_made: 2, points_earned: 2 },
                player: {
                  event_player_id: 'player-2',
                  player_id: 'player-b',
                  full_name: 'Player Two',
                  nickname: null,
                  player_number: 18,
                  frames_completed: 1,
                  total_frames_required: 1,
                  total_points: 2,
                  is_complete: true,
                },
              },
            ],
          }),
        };
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    global.fetch = fetchMock as unknown as typeof fetch;

    const user = userEvent.setup();
    render(<QualificationScoringPage />);

    expect(await screen.findByText('1 / 1')).toBeInTheDocument();

    const oneButtons = screen.getAllByRole('radio', { name: /^1 putts made/ });
    await user.click(oneButtons[0]);
    await user.click(oneButtons[1]);
    await user.click(screen.getByRole('button', { name: /review/i }));

    await waitFor(() => {
      expect(screen.getByText('Review scores')).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: /submit scores/i })).toBeInTheDocument();
    expect(screen.getByTitle('Edit frame 1')).toBeInTheDocument();

    // Both players' scores went in one request.
    const saves = fetchMock.mock.calls.filter(([url]) => String(url) === '/api/score/qualification/frames');
    expect(saves).toHaveLength(1);
    expect(JSON.parse(String((saves[0] as unknown as [string, RequestInit])[1].body))).toEqual({
      access_code: 'code-123',
      frame_number: 1,
      scores: [
        { event_player_id: 'player-1', putts_made: 1 },
        { event_player_id: 'player-2', putts_made: 1 },
      ],
    });
  });

  it('renders persisted scores for selected players on the active frame', async () => {
    const fetchMock = jest.fn(async () => ({
      ok: true,
      json: async () => createBatchResponse(),
    }));

    global.fetch = fetchMock as unknown as typeof fetch;

    render(<QualificationScoringPage />);

    expect(await screen.findByText('1 / 3')).toBeInTheDocument();
    expect(screen.getByText('#18')).toBeInTheDocument();
    expect(screen.getAllByRole('radio', { name: /^2 putts made/, checked: true })).toHaveLength(1);
  });

  it('returns to scoring when editing a frame from review', async () => {
    const fetchMock = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        event: {
          id: 'event-1',
          event_date: '2026-03-15',
          location: 'Test Venue',
          bonus_point_enabled: true,
        },
        round: {
          id: 'round-1',
          frame_count: 1,
        },
        players: [
          {
            event_player_id: 'player-1',
            player_id: 'player-a',
            full_name: 'Player One',
            nickname: null,
            player_number: 12,
            frames_completed: 1,
            total_frames_required: 1,
            total_points: 4,
            is_complete: true,
            frames: [
              {
                id: 'frame-1-player-1',
                frame_number: 1,
                putts_made: 3,
                points_earned: 4,
              },
            ],
          },
        ],
      }),
    }));

    global.fetch = fetchMock as unknown as typeof fetch;

    const user = userEvent.setup();
    render(<QualificationScoringPage />);

    expect(await screen.findByRole('button', { name: /review/i })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /review/i }));

    expect(await screen.findByText('Review scores')).toBeInTheDocument();
    await user.click(screen.getByTitle('Edit frame 1'));

    expect(await screen.findByText('1 / 1')).toBeInTheDocument();
  });

  it('preserves newer local scores when clearing saved frame entries', () => {
    const previousScores = new Map([
      ['player-1:1', 2],
      ['player-2:1', 1],
    ]);
    const sentScoresByKey = new Map([
      ['player-1:1', 1],
      ['player-2:1', 1],
    ]);

    const nextScores = clearSentLocalScores(previousScores, sentScoresByKey);

    expect(nextScores.get('player-1:1')).toBe(2);
    expect(nextScores.has('player-2:1')).toBe(false);
  });

  it('disables score steppers while saving', async () => {
    let resolvePlayerOneSave: (() => void) | undefined;

    const fetchMock = jest.fn((input: RequestInfo | URL) => {
      const url = String(input);

      if (url === '/api/score/qualification/batch') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            event: {
              id: 'event-1',
              event_date: '2026-03-15',
              location: 'Test Venue',
              bonus_point_enabled: true,
            },
            round: {
              id: 'round-1',
              frame_count: 1,
            },
            players: [
              {
                event_player_id: 'player-1',
                player_id: 'player-a',
                full_name: 'Player One',
                nickname: null,
                player_number: 12,
                frames_completed: 0,
                total_frames_required: 1,
                total_points: 0,
                is_complete: false,
                frames: [],
              },
            ],
          }),
        });
      }

      if (url === '/api/score/qualification/frames') {
        return new Promise((resolve) => {
          resolvePlayerOneSave = () =>
            resolve({
              ok: true,
              json: async () => ({
                results: [
                  {
                    frame: {
                      id: 'frame-1-player-1',
                      frame_number: 1,
                      putts_made: 1,
                      points_earned: 0,
                    },
                    player: {
                      event_player_id: 'player-1',
                      player_id: 'player-a',
                      full_name: 'Player One',
                      nickname: null,
                      player_number: 12,
                      frames_completed: 1,
                      total_frames_required: 1,
                      total_points: 0,
                      is_complete: true,
                    },
                  },
                ],
              }),
            });
        });
      }

      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });

    global.fetch = fetchMock as unknown as typeof fetch;

    const user = userEvent.setup();
    render(<QualificationScoringPage />);

    expect(await screen.findByText('1 / 1')).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: /^1 putts made/ }));
    await user.click(screen.getByRole('button', { name: /review/i }));

    await waitFor(() => {
      expect(screen.getByRole('radio', { name: /^1 putts made/ })).toBeDisabled();
      expect(screen.getByRole('radio', { name: /^0 putts made/ })).toBeDisabled();
    });

    resolvePlayerOneSave?.();

    await waitFor(() => {
      expect(screen.getByText('Review scores')).toBeInTheDocument();
    });
  });

});
