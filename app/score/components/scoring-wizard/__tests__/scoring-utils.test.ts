import { countCompletedFrames } from '../scoring-utils';

const players = ['a', 'b', 'c', 'd'];

function frame(frameNumber: number, playerIds: string[]) {
  return {
    frame_number: frameNumber,
    results: playerIds.map((id) => ({ event_player_id: id, putts_made: 2 })),
  };
}

describe('countCompletedFrames', () => {
  it('returns 0 with no frames', () => {
    expect(countCompletedFrames([], players)).toBe(0);
  });

  it('counts only frames scored for every player', () => {
    const frames = [frame(1, players), frame(2, players), frame(3, ['a', 'b', 'c'])];
    expect(countCompletedFrames(frames, players)).toBe(2);
  });

  it('counts overtime frames', () => {
    const frames = [1, 2, 3, 4, 5, 6].map((n) => frame(n, players));
    expect(countCompletedFrames(frames, players)).toBe(6);
  });

  it('returns 0 when there are no players', () => {
    expect(countCompletedFrames([frame(1, players)], [])).toBe(0);
  });
});
