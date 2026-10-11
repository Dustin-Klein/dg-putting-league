import { render, screen } from '@testing-library/react';
import { Status, type Match } from 'brackets-model';
import { MatchCard } from '../match-card';

const match: Match = { id: 1, stage_id: 1, group_id: 1, round_id: 1, number: 1, child_count: 0,
  status: Status.Ready, opponent1: { id: 0 }, opponent2: { id: 2 } };

beforeAll(() => {
  global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
});

it('shows a steady violet indicator in the match-number column and removes it when assigned or running', () => {
  const { container, rerender } = render(<MatchCard match={match} matchNumber={1} onDeckPosition={1} />);
  const label = screen.getByLabelText('On deck #1');
  expect(label.parentElement).toHaveTextContent('M1');
  expect(label).toHaveTextContent('#1');
  rerender(<MatchCard match={match} matchNumber={1} onDeckPosition={2} />);
  expect(screen.getByLabelText('On deck #2')).toHaveTextContent('#2');
  expect(container.querySelector('.border-violet-500')).toBeInTheDocument();
  expect(container.querySelector('.animate-pulse-ring')).toBeNull();
  rerender(<MatchCard match={match} matchNumber={1} onDeckPosition={1} laneLabel="Lane 1" />);
  expect(screen.queryByLabelText('On deck #1')).toBeNull();
  expect(container.querySelector('.border-amber-500')).toBeInTheDocument();
  rerender(<MatchCard match={{ ...match, status: Status.Running }} matchNumber={1} onDeckPosition={1} />);
  expect(screen.queryByLabelText('On deck #1')).toBeNull();
  expect(container.querySelector('.border-blue-400')).toBeInTheDocument();
  rerender(<MatchCard match={match} matchNumber={1} onDeckPosition={1} isIdle />);
  expect(screen.queryByLabelText('On deck #1')).toBeNull();
  expect(container.querySelector('.border-red-500')).toBeInTheDocument();
});
