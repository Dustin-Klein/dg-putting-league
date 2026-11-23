import { Status } from 'brackets-model';
import { isByeMatch, isScheduledMatch, playedMatchState } from '../match-state';

const both = { opponent1: { id: 1, result: 'win' }, opponent2: { id: 2, result: 'loss' } };
const pending = { opponent1: { id: 1 }, opponent2: { id: 2 } };

describe('played-match predicate', () => {
  it('excludes BYEs and TBD slots', () => {
    expect(isByeMatch({ opponent1: { id: 1 }, opponent2: null })).toBe(true);
    expect(playedMatchState({ status: Status.Completed, opponent1: { id: 1, result: 'win' }, opponent2: null }, 0)).toBeNull();
    expect(playedMatchState({ status: Status.Running, opponent1: { id: 1 }, opponent2: { id: null } }, 3)).toBeNull();
  });

  it('counts completed and archived matches with a result', () => {
    expect(playedMatchState({ status: Status.Completed, ...both }, 5)).toBe('completed');
    expect(playedMatchState({ status: Status.Archived, ...both }, 0)).toBe('completed');
  });

  it('excludes the unused archived grand-final reset', () => {
    expect(playedMatchState({ status: Status.Archived, ...pending }, 0)).toBeNull();
    expect(isScheduledMatch({ status: Status.Archived, ...pending }, 0, { isGrandFinalReset: true })).toBe(false);
    expect(isScheduledMatch({ status: Status.Locked, ...pending }, 0, { isGrandFinalReset: true })).toBe(false);
    expect(isScheduledMatch({ status: Status.Ready, ...pending }, 0, { isGrandFinalReset: true })).toBe(true);
  });

  it('counts a live match once it has a frame', () => {
    expect(playedMatchState({ status: Status.Running, ...pending }, 0)).toBeNull();
    expect(playedMatchState({ status: Status.Running, ...pending }, 1)).toBe('in_progress');
    expect(isScheduledMatch({ status: Status.Waiting, opponent1: { id: null }, opponent2: { id: null } }, 0, { isGrandFinalReset: false })).toBe(true);
  });
});
