import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CombinedScore, ManualTeamEditor } from '../manual-team-editor';
import type { TeamPreviewPlayer } from '@/lib/types/team';
import type { TeamDraft } from '@/lib/utils/team-utils';

const players: TeamPreviewPlayer[] = [
  { eventPlayerId: 'a', playerName: 'Alice', pfaScore: 3.1, scoringMethod: 'pfa', pool: null },
  { eventPlayerId: 'b', playerName: 'Bob', pfaScore: 2.4, scoringMethod: 'pfa', pool: null },
  { eventPlayerId: 'c', playerName: 'Cy', pfaScore: 0, scoringMethod: 'default', pool: null },
  { eventPlayerId: 'd', playerName: 'Di', pfaScore: 1.5, scoringMethod: 'pfa', pool: null },
];

describe('ManualTeamEditor', () => {
  it('adds an unassigned player to the first open slot', async () => {
    const onChange = jest.fn();
    const draft: TeamDraft = [['a', null], [null, null]];
    render(<ManualTeamEditor players={players} draft={draft} onChange={onChange} />);

    expect(screen.getByText('Unassigned players')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Bob/ }));

    expect(onChange).toHaveBeenCalledWith([['a', 'b'], [null, null]]);
  });

  it('removes a player back to the unassigned list', async () => {
    const onChange = jest.fn();
    render(<ManualTeamEditor players={players} draft={[['a', 'b'], ['c', 'd']]} onChange={onChange} />);

    expect(screen.getByText('Everyone is on a team.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Remove Cy from team 2' }));

    expect(onChange).toHaveBeenCalledWith([['a', 'b'], [null, 'd']]);
  });

  it('shows each team’s server-computed scores', () => {
    render(<ManualTeamEditor players={players} draft={[['a', 'b'], ['c', 'd']]} onChange={jest.fn()} />);
    expect(screen.getByText('= 5.50', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('Incomplete')).toBeInTheDocument();
  });
});

describe('CombinedScore', () => {
  it('shows a single player’s score without a sum', () => {
    render(<CombinedScore members={[players[0]]} />);
    expect(screen.getByText('3.10')).toBeInTheDocument();
  });

  it('reads "No data" when nobody has a score', () => {
    render(<CombinedScore members={[players[2]]} />);
    expect(screen.getByText(/No data/)).toBeInTheDocument();
  });
});
