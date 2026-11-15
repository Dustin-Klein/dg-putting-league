import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ScoreStepperRow } from '../score-stepper-row';

function Row({
  initial = null,
  bonus = true,
  disabled = false,
  onChange,
}: {
  initial?: number | null;
  bonus?: boolean;
  disabled?: boolean;
  onChange?: (putts: number) => void;
}) {
  const [score, setScore] = useState<number | null>(initial);
  return (
    <ScoreStepperRow
      label="Avery Lund"
      score={score}
      bonusPointEnabled={bonus}
      frameNumber={2}
      disabled={disabled}
      onChange={(putts) => {
        setScore(putts);
        onChange?.(putts);
      }}
    />
  );
}

const plus = () => screen.getByRole('button', { name: 'Increase score for Avery Lund' });
const minus = () => screen.getByRole('button', { name: 'Decrease score for Avery Lund' });
const box = () => screen.getByRole('status');

describe('ScoreStepperRow', () => {
  it('labels the group with the player and frame', () => {
    render(<Row />);
    expect(screen.getByRole('group', { name: 'Putts made by Avery Lund, frame 2' })).toBeInTheDocument();
  });

  it('starts unscored; + gives 1', async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();
    render(<Row onChange={onChange} />);
    expect(box()).toHaveTextContent('Not scored');

    await user.click(plus());
    expect(onChange).toHaveBeenLastCalledWith(1);
    expect(box()).toHaveTextContent('1 point');
  });

  it('starts unscored; − gives 0 and then stops', async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();
    render(<Row onChange={onChange} />);

    await user.click(minus());
    expect(onChange).toHaveBeenLastCalledWith(0);
    expect(box()).toHaveTextContent('0 points');
    expect(minus()).toBeDisabled();
    expect(plus()).toBeEnabled();
  });

  it('counts up to 3 putts and shows 4 points with the bonus', async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();
    render(<Row initial={2} onChange={onChange} />);

    await user.click(plus());
    expect(onChange).toHaveBeenLastCalledWith(3);
    expect(box()).toHaveTextContent('4 points');
    expect(screen.getByText(/3 of 3 made/)).toBeInTheDocument();
    expect(screen.getByText('+1 bonus')).toBeInTheDocument();
    expect(plus()).toBeDisabled();
  });

  it('shows 3 points for 3 putts without the bonus', () => {
    render(<Row initial={3} bonus={false} />);
    expect(box()).toHaveTextContent('3 points');
    expect(screen.getByText('3 of 3 made')).toBeInTheDocument();
    expect(screen.queryByText('+1 bonus')).not.toBeInTheDocument();
  });

  it('steps down from a score', async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();
    render(<Row initial={3} onChange={onChange} />);

    await user.click(minus());
    expect(onChange).toHaveBeenLastCalledWith(2);
    expect(box()).toHaveTextContent('2 points');
  });

  it('disables both buttons while saving', () => {
    render(<Row initial={1} disabled />);
    expect(minus()).toBeDisabled();
    expect(plus()).toBeDisabled();
  });
});
