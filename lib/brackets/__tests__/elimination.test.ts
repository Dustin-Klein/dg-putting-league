import { eliminatedTeamIds } from '../elimination';
import type { DecidedMatch } from '../placements';

const lost = (
  loserTeamId: string,
  groupNumber: number,
  roundNumber = 1,
  loserSlot: 'opponent1' | 'opponent2' = 'opponent2'
): DecidedMatch => ({
  id: Math.floor(Math.random() * 1e6),
  groupNumber,
  roundNumber,
  isLastRoundOfGroup: false,
  winnerTeamId: `beat-${loserTeamId}`,
  loserTeamId,
  loserSlot,
});

describe('eliminatedTeamIds', () => {
  it('single elimination knocks out every loser, third-place match included', () => {
    expect(eliminatedTeamIds('single_elimination', false, [lost('a', 1), lost('b', 1, 2), lost('c', 2)]))
      .toEqual(new Set(['a', 'b', 'c']));
  });

  it('double elimination keeps winners-bracket losers alive', () => {
    expect(eliminatedTeamIds('double_elimination', true, [lost('a', 1), lost('b', 2)])).toEqual(new Set(['b']));
  });

  it('a winners-bracket champion who loses the first grand final plays the reset', () => {
    expect(eliminatedTeamIds('double_elimination', true, [lost('wb-champ', 3, 1, 'opponent1')])).toEqual(new Set());
    expect(eliminatedTeamIds('double_elimination', true, [lost('wb-champ', 3, 1, 'opponent1'), lost('wb-champ', 3, 2)]))
      .toEqual(new Set(['wb-champ']));
  });

  it('the losers-bracket champion is out after one grand-final loss', () => {
    expect(eliminatedTeamIds('double_elimination', true, [lost('lb-champ', 3, 1, 'opponent2')]))
      .toEqual(new Set(['lb-champ']));
  });

  it('without a reset, either grand-final loser is out', () => {
    expect(eliminatedTeamIds('double_elimination', false, [lost('wb-champ', 3, 1, 'opponent1')]))
      .toEqual(new Set(['wb-champ']));
  });

  it('ignores matches without a loser (byes)', () => {
    expect(eliminatedTeamIds('single_elimination', false, [{ ...lost('x', 1), loserTeamId: undefined }]))
      .toEqual(new Set());
  });
});
