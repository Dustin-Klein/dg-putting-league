import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PuttScoreRow } from '../putt-score-row';

function Row({ initial = null, onChange }: { initial?: number | null; onChange?: (putts: number) => void }) {
  const [score, setScore] = useState<number | null>(initial);
  return (
    <PuttScoreRow
      label="Avery Lund"
      score={score}
      bonusPointEnabled
      onChange={(putts) => {
        setScore(putts);
        onChange?.(putts);
      }}
    />
  );
}

const radio = (putts: number) => screen.getByRole('radio', { name: new RegExp(`^${putts} putts made`) });

describe('PuttScoreRow keyboard', () => {
  it('is a single Tab stop: the chosen score, or the first when unscored', () => {
    const { unmount } = render(<Row />);
    expect(radio(0)).toHaveAttribute('tabindex', '0');
    expect(radio(2)).toHaveAttribute('tabindex', '-1');
    unmount();

    render(<Row initial={2} />);
    expect(radio(2)).toHaveAttribute('tabindex', '0');
    expect(radio(0)).toHaveAttribute('tabindex', '-1');
  });

  it('moves focus and picks the score with the arrow keys, wrapping at the ends', async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();
    render(<Row initial={1} onChange={onChange} />);

    await user.tab();
    expect(radio(1)).toHaveFocus();

    await user.keyboard('{ArrowRight}');
    expect(radio(2)).toHaveFocus();
    expect(radio(2)).toHaveAttribute('aria-checked', 'true');

    await user.keyboard('{End}{ArrowRight}');
    expect(radio(0)).toHaveFocus();
    expect(radio(0)).toHaveAttribute('aria-checked', 'true');

    await user.keyboard('{ArrowLeft}');
    expect(radio(3)).toHaveFocus();
    expect(onChange).toHaveBeenLastCalledWith(3);
  });
});
