import { act, render, screen } from '@testing-library/react';
import { SCORING_MODE_KEY, setScoringMode, useScoringMode } from '../use-scoring-mode';

function Probe() {
  const [mode] = useScoringMode();
  return <span data-testid="mode">{mode}</span>;
}

const mode = () => screen.getByTestId('mode').textContent;

describe('useScoringMode', () => {
  afterEach(() => {
    localStorage.clear();
    jest.restoreAllMocks();
  });

  it('defaults to one-tap scoring', () => {
    render(<Probe />);
    expect(mode()).toBe('tap');
  });

  it('reads David scoring saved on this device', () => {
    localStorage.setItem(SCORING_MODE_KEY, 'david');
    render(<Probe />);
    expect(mode()).toBe('david');
  });

  it('treats an unknown stored value as the default', () => {
    localStorage.setItem(SCORING_MODE_KEY, 'something-else');
    render(<Probe />);
    expect(mode()).toBe('tap');
  });

  it('saves the choice and updates every mounted reader', () => {
    render(
      <>
        <Probe />
        <Probe />
      </>
    );
    act(() => setScoringMode('david'));
    expect(screen.getAllByTestId('mode').map((el) => el.textContent)).toEqual(['david', 'david']);
    expect(localStorage.getItem(SCORING_MODE_KEY)).toBe('david');

    act(() => setScoringMode('tap'));
    expect(screen.getAllByTestId('mode').map((el) => el.textContent)).toEqual(['tap', 'tap']);
    expect(localStorage.getItem(SCORING_MODE_KEY)).toBeNull();
  });

  it('follows a change made in another tab', () => {
    render(<Probe />);
    act(() => {
      localStorage.setItem(SCORING_MODE_KEY, 'david');
      window.dispatchEvent(new StorageEvent('storage', { key: SCORING_MODE_KEY }));
    });
    expect(mode()).toBe('david');
  });

  it('falls back to the default when storage throws', () => {
    jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    render(<Probe />);
    expect(mode()).toBe('tap');
    expect(() => act(() => setScoringMode('david'))).not.toThrow();
  });
});
