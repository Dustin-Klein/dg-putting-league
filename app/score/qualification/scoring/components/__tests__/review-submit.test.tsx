import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QualificationReviewSubmit } from '../review-submit';

const players = [
  {
    event_player_id: 'player-1',
    full_name: 'Player One',
    player_number: 12,
    total_points: 4,
    frames: [
      {
        id: 'frame-1-player-1',
        frame_number: 1,
        putts_made: 3,
        points_earned: 4,
      },
    ],
  },
];

describe('QualificationReviewSubmit', () => {
  it('disables review navigation controls while submitting', async () => {
    const onSubmit = jest.fn();
    const onEditFrame = jest.fn();
    const onBack = jest.fn();
    const user = userEvent.setup();

    render(
      <QualificationReviewSubmit
        players={players}
        frameCount={1}
        isSubmitting
        onSubmit={onSubmit}
        onEditFrame={onEditFrame}
        onBack={onBack}
      />
    );

    const backButton = screen.getByRole('button', { name: /back to scoring/i });
    const editButton = screen.getByTitle('Edit frame 1');
    const submitButton = screen.getByRole('button', { name: /submitting/i });

    expect(backButton).toBeDisabled();
    expect(editButton).toBeDisabled();
    expect(submitButton).toBeDisabled();

    await user.click(backButton);
    await user.click(editButton);
    await user.click(submitButton);

    expect(onBack).not.toHaveBeenCalled();
    expect(onEditFrame).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
