import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FrameWizard } from '../frame-wizard';
import type { MatchInfo, ScoreState, PlayerInfo, TeamInfo, FrameInfo } from '../wizard-types';
import { MIN_PUTTS, MAX_PUTTS } from '../wizard-types';

function createPlayer(overrides: Partial<PlayerInfo> = {}): PlayerInfo {
  return {
    event_player_id: 'player-1',
    role: 'A_pool',
    full_name: 'Player One',
    nickname: null,
    ...overrides,
  };
}

function createTeam(overrides: Partial<TeamInfo> = {}): TeamInfo {
  return {
    id: 'team-1',
    seed: 1,
    pool_combo: 'Player A & Player B',
    players: [
      createPlayer({ event_player_id: 'player-1a', role: 'A_pool', full_name: 'Player 1A' }),
      createPlayer({ event_player_id: 'player-1b', role: 'B_pool', full_name: 'Player 1B' }),
    ],
    ...overrides,
  };
}

function createMatch(overrides: Partial<MatchInfo> = {}): MatchInfo {
  return {
    id: 'match-1',
    bracket_match_id: 1,
    round_name: 'Round 1',
    status: 'in_progress',
    lane_label: 'Lane 1',
    team_one: createTeam({
      id: 'team-1',
      seed: 1,
      players: [
        createPlayer({ event_player_id: 'p1a', role: 'A_pool', full_name: 'Team1 PlayerA' }),
        createPlayer({ event_player_id: 'p1b', role: 'B_pool', full_name: 'Team1 PlayerB' }),
      ],
    }),
    team_two: createTeam({
      id: 'team-2',
      seed: 2,
      pool_combo: 'Player C & Player D',
      players: [
        createPlayer({ event_player_id: 'p2a', role: 'A_pool', full_name: 'Team2 PlayerA' }),
        createPlayer({ event_player_id: 'p2b', role: 'B_pool', full_name: 'Team2 PlayerB' }),
      ],
    }),
    team_one_score: 0,
    team_two_score: 0,
    frames: [],
    ...overrides,
  };
}

function createFrame(frameNumber: number, results: FrameInfo['results'] = []): FrameInfo {
  return {
    id: `frame-${frameNumber}`,
    frame_number: frameNumber,
    is_overtime: frameNumber > 5,
    results,
  };
}

const defaultProps = {
  match: createMatch(),
  localScores: new Map() as ScoreState,
  bonusPointEnabled: true,
  standardFrames: 5,
  currentFrame: 1,
  onScoreChange: jest.fn(),
  onNextFrame: jest.fn().mockResolvedValue(undefined),
  onPrevFrame: jest.fn().mockResolvedValue(undefined),
  onGoToFrame: jest.fn().mockResolvedValue(undefined),
  onFinish: jest.fn().mockResolvedValue(undefined),
  onBack: jest.fn(),
};

describe('FrameWizard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Rendering', () => {
    it('renders frame indicator correctly', () => {
      render(<FrameWizard {...defaultProps} />);

      expect(screen.getByText('F1')).toBeInTheDocument();
    });

    it('renders overtime frame indicator correctly', () => {
      render(<FrameWizard {...defaultProps} currentFrame={6} />);

      expect(screen.getByText('OT1')).toBeInTheDocument();
    });

    it('displays all players from both teams', () => {
      render(<FrameWizard {...defaultProps} />);

      expect(screen.getByText('Team1 PlayerA')).toBeInTheDocument();
      expect(screen.getByText('Team1 PlayerB')).toBeInTheDocument();
      expect(screen.getByText('Team2 PlayerA')).toBeInTheDocument();
      expect(screen.getByText('Team2 PlayerB')).toBeInTheDocument();
    });

    it('shows frame navigation dots for all standard frames', () => {
      render(<FrameWizard {...defaultProps} />);

      // Should have 5 standard frame buttons
      for (let i = 1; i <= 5; i++) {
        expect(screen.getByRole('button', { name: `Go to frame ${i}` })).toBeInTheDocument();
      }
    });

    it('shows team scores', () => {
      render(<FrameWizard {...defaultProps} />);

      // Both teams start at 0
      const scores = screen.getAllByText('0');
      expect(scores.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Score increment/decrement', () => {
    it('increments score when clicking plus button', async () => {
      const user = userEvent.setup();
      const onScoreChange = jest.fn();
      render(<FrameWizard {...defaultProps} onScoreChange={onScoreChange} />);

      const increaseButtons = screen.getAllByRole('button', { name: /increase score/i });
      await user.click(increaseButtons[0]);

      expect(onScoreChange).toHaveBeenCalledWith('p1a', 1, 0);
    });

    it('increments from existing score', async () => {
      const user = userEvent.setup();
      const onScoreChange = jest.fn();
      const localScores = new Map([['p1a-1', 1]]);
      render(
        <FrameWizard {...defaultProps} localScores={localScores} onScoreChange={onScoreChange} />
      );

      const increaseButtons = screen.getAllByRole('button', { name: /increase score/i });
      await user.click(increaseButtons[0]);

      expect(onScoreChange).toHaveBeenCalledWith('p1a', 1, 2);
    });

    it('does not exceed MAX_PUTTS when incrementing', () => {
      const localScores = new Map([['p1a-1', MAX_PUTTS]]);
      render(<FrameWizard {...defaultProps} localScores={localScores} />);

      const increaseButtons = screen.getAllByRole('button', { name: /increase score/i });
      expect(increaseButtons[0]).toBeDisabled();
    });

    it('decrements score when clicking minus button', async () => {
      const user = userEvent.setup();
      const onScoreChange = jest.fn();
      const localScores = new Map([['p1a-1', 2]]);
      render(
        <FrameWizard {...defaultProps} localScores={localScores} onScoreChange={onScoreChange} />
      );

      const decreaseButtons = screen.getAllByRole('button', { name: /decrease score/i });
      await user.click(decreaseButtons[0]);

      expect(onScoreChange).toHaveBeenCalledWith('p1a', 1, 1);
    });

    it('does not go below MIN_PUTTS when decrementing', () => {
      const localScores = new Map([['p1a-1', MIN_PUTTS]]);
      render(<FrameWizard {...defaultProps} localScores={localScores} />);

      const decreaseButtons = screen.getAllByRole('button', { name: /decrease score/i });
      expect(decreaseButtons[0]).toBeDisabled();
    });

    it('disables decrement button when no score is set', () => {
      render(<FrameWizard {...defaultProps} />);

      const decreaseButtons = screen.getAllByRole('button', { name: /decrease score/i });
      decreaseButtons.forEach((button) => {
        expect(button).toBeDisabled();
      });
    });
  });

  describe('Frame navigation', () => {
    it('disables prev button on frame 1', () => {
      render(<FrameWizard {...defaultProps} currentFrame={1} />);

      expect(screen.getByRole('button', { name: /prev/i })).toBeDisabled();
    });

    it('enables prev button on frame > 1', () => {
      render(<FrameWizard {...defaultProps} currentFrame={2} />);

      expect(screen.getByRole('button', { name: /prev/i })).toBeEnabled();
    });

    it('calls onPrevFrame when clicking prev', async () => {
      const user = userEvent.setup();
      const onPrevFrame = jest.fn().mockResolvedValue(undefined);
      render(<FrameWizard {...defaultProps} currentFrame={2} onPrevFrame={onPrevFrame} />);

      await user.click(screen.getByRole('button', { name: /prev/i }));

      expect(onPrevFrame).toHaveBeenCalled();
    });

    it('disables next button when frame is incomplete', () => {
      render(<FrameWizard {...defaultProps} />);

      expect(screen.getByRole('button', { name: /next/i })).toBeDisabled();
    });

    it('enables next button when all players have scored', () => {
      const localScores = new Map([
        ['p1a-1', 2],
        ['p1b-1', 2],
        ['p2a-1', 2],
        ['p2b-1', 2],
      ]);
      render(<FrameWizard {...defaultProps} localScores={localScores} />);

      expect(screen.getByRole('button', { name: /next/i })).toBeEnabled();
    });

    it('calls onNextFrame when clicking next', async () => {
      const user = userEvent.setup();
      const onNextFrame = jest.fn().mockResolvedValue(undefined);
      const localScores = new Map([
        ['p1a-1', 2],
        ['p1b-1', 2],
        ['p2a-1', 2],
        ['p2b-1', 2],
      ]);
      render(
        <FrameWizard {...defaultProps} localScores={localScores} onNextFrame={onNextFrame} />
      );

      await user.click(screen.getByRole('button', { name: /next/i }));

      expect(onNextFrame).toHaveBeenCalled();
    });

    it('calls onGoToFrame when clicking frame dot', async () => {
      const user = userEvent.setup();
      const onGoToFrame = jest.fn().mockResolvedValue(undefined);
      render(<FrameWizard {...defaultProps} onGoToFrame={onGoToFrame} />);

      await user.click(screen.getByRole('button', { name: /go to frame 3/i }));

      expect(onGoToFrame).toHaveBeenCalledWith(3);
    });

    it('does not call onGoToFrame when clicking current frame', async () => {
      const user = userEvent.setup();
      const onGoToFrame = jest.fn().mockResolvedValue(undefined);
      render(<FrameWizard {...defaultProps} currentFrame={3} onGoToFrame={onGoToFrame} />);

      await user.click(screen.getByRole('button', { name: /go to frame 3/i }));

      expect(onGoToFrame).not.toHaveBeenCalled();
    });
  });

  describe('Overtime detection and triggering', () => {
    it('shows overtime prompt when tied on last regular frame', () => {
      // Both teams at equal score, on frame 5 (last regular), all scores entered
      const localScores = new Map([
        ['p1a-5', 2],
        ['p1b-5', 2],
        ['p2a-5', 2],
        ['p2b-5', 2],
      ]);
      render(
        <FrameWizard
          {...defaultProps}
          currentFrame={5}
          localScores={localScores}
          match={createMatch({ team_one_score: 20, team_two_score: 20 })}
        />
      );

      expect(screen.getByText(/tied! continue to overtime/i)).toBeInTheDocument();
    });

    it('shows "Overtime" button text when tied and complete', () => {
      const localScores = new Map([
        ['p1a-5', 2],
        ['p1b-5', 2],
        ['p2a-5', 2],
        ['p2b-5', 2],
      ]);
      render(
        <FrameWizard
          {...defaultProps}
          currentFrame={5}
          localScores={localScores}
          match={createMatch({ team_one_score: 20, team_two_score: 20 })}
        />
      );

      expect(screen.getByRole('button', { name: /overtime/i })).toBeInTheDocument();
    });

    it('displays overtime notice when in overtime frame', () => {
      render(<FrameWizard {...defaultProps} currentFrame={6} />);

      expect(screen.getByText(/overtime – continue until there's a winner/i)).toBeInTheDocument();
    });

    it('shows overtime frame in navigation with O prefix', () => {
      const match = createMatch({
        frames: [createFrame(6)],
      });
      render(<FrameWizard {...defaultProps} match={match} currentFrame={6} />);

      expect(screen.getByText('O1')).toBeInTheDocument();
    });
  });

  describe('Team score calculations', () => {
    it('calculates points correctly with bonus point', () => {
      // 3 putts = 4 points with bonus
      const localScores = new Map([
        ['p1a-1', 3],
        ['p1b-1', 3],
        ['p2a-1', 2],
        ['p2b-1', 2],
      ]);
      render(
        <FrameWizard {...defaultProps} localScores={localScores} bonusPointEnabled={true} />
      );

      // Team 1: 4+4=8 pts, Team 2: 2+2=4 pts for frame
      expect(screen.getByText('8 pts')).toBeInTheDocument();
      expect(screen.getByText('4 pts')).toBeInTheDocument();
    });

    it('calculates points correctly without bonus point', () => {
      // 3 putts = 3 points without bonus
      const localScores = new Map([
        ['p1a-1', 3],
        ['p1b-1', 3],
        ['p2a-1', 2],
        ['p2b-1', 2],
      ]);
      render(
        <FrameWizard {...defaultProps} localScores={localScores} bonusPointEnabled={false} />
      );

      // Team 1: 3+3=6 pts, Team 2: 2+2=4 pts for frame
      expect(screen.getByText('6 pts')).toBeInTheDocument();
      expect(screen.getByText('4 pts')).toBeInTheDocument();
    });

    it('shows individual player points conversion', () => {
      const localScores = new Map([['p1a-1', 2]]);
      render(<FrameWizard {...defaultProps} localScores={localScores} bonusPointEnabled={true} />);

      // Score of 2 = 2 points
      expect(screen.getByText(/→ 2pt/)).toBeInTheDocument();
    });
  });

  describe('Frame completion checks', () => {
    it('shows incomplete frame message when not all players scored', () => {
      const localScores = new Map([
        ['p1a-1', 2],
        ['p1b-1', 2],
      ]);
      render(<FrameWizard {...defaultProps} localScores={localScores} />);

      expect(screen.getByText(/enter scores for all players to continue/i)).toBeInTheDocument();
    });

    it('hides incomplete frame message when all players scored', () => {
      const localScores = new Map([
        ['p1a-1', 2],
        ['p1b-1', 2],
        ['p2a-1', 2],
        ['p2b-1', 2],
      ]);
      render(<FrameWizard {...defaultProps} localScores={localScores} />);

      expect(
        screen.queryByText(/enter scores for all players to continue/i)
      ).not.toBeInTheDocument();
    });
  });

  describe('Finish match', () => {
    it('shows Review button when match can be finished', () => {
      // Not tied, on last frame, frame complete
      const localScores = new Map([
        ['p1a-5', 3],
        ['p1b-5', 3],
        ['p2a-5', 1],
        ['p2b-5', 1],
      ]);
      const match = createMatch({ team_one_score: 30, team_two_score: 20 });
      render(
        <FrameWizard
          {...defaultProps}
          match={match}
          currentFrame={5}
          localScores={localScores}
        />
      );

      expect(screen.getByRole('button', { name: /review/i })).toBeInTheDocument();
    });

    it('shows Review button in overtime when not tied', () => {
      const localScores = new Map([
        ['p1a-6', 3],
        ['p1b-6', 3],
        ['p2a-6', 1],
        ['p2b-6', 1],
      ]);
      const match = createMatch({
        team_one_score: 28,
        team_two_score: 20,
        frames: [createFrame(6)],
      });
      render(
        <FrameWizard
          {...defaultProps}
          match={match}
          currentFrame={6}
          localScores={localScores}
        />
      );

      expect(screen.getByRole('button', { name: /review/i })).toBeInTheDocument();
    });

    it('calls onFinish when clicking Review button', async () => {
      const user = userEvent.setup();
      const onFinish = jest.fn().mockResolvedValue(undefined);
      const localScores = new Map([
        ['p1a-5', 3],
        ['p1b-5', 3],
        ['p2a-5', 1],
        ['p2b-5', 1],
      ]);
      const match = createMatch({ team_one_score: 30, team_two_score: 20 });
      render(
        <FrameWizard
          {...defaultProps}
          match={match}
          currentFrame={5}
          localScores={localScores}
          onFinish={onFinish}
        />
      );

      await user.click(screen.getByRole('button', { name: /review/i }));

      expect(onFinish).toHaveBeenCalled();
    });
  });

  describe('Back navigation', () => {
    it('calls onBack when clicking Setup button', async () => {
      const user = userEvent.setup();
      const onBack = jest.fn();
      render(<FrameWizard {...defaultProps} onBack={onBack} />);

      await user.click(screen.getByRole('button', { name: /setup/i }));

      expect(onBack).toHaveBeenCalled();
    });
  });

  describe('Loading states', () => {
    it('shows loading state on navigation buttons while saving', async () => {
      const user = userEvent.setup();
      const onNextFrame = jest.fn().mockImplementation(() => new Promise(() => {}));
      const localScores = new Map([
        ['p1a-1', 2],
        ['p1b-1', 2],
        ['p2a-1', 2],
        ['p2b-1', 2],
      ]);
      render(
        <FrameWizard {...defaultProps} localScores={localScores} onNextFrame={onNextFrame} />
      );

      await user.click(screen.getByRole('button', { name: /next/i }));

      // Frame dots should be disabled during save
      const frameDots = screen.getAllByRole('button', { name: /go to frame/i });
      frameDots.forEach((dot) => {
        expect(dot).toBeDisabled();
      });
    });
  });
});
