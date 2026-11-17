import { type BracketFormat, groupRole } from './format';
import type { DecidedMatch } from './placements';

/**
 * Teams knocked out of a bracket so far, mirroring brackets-manager's progression:
 * single elimination drops every loser; double elimination drops losers-bracket
 * losers and grand-final losers with no reset left to play. A winners-bracket loss
 * only moves a team to the losers bracket, and a BYE has no loser.
 */
export function eliminatedTeamIds(
  format: BracketFormat,
  doubleGrandFinal: boolean,
  decided: readonly DecidedMatch[]
): Set<string> {
  const eliminated = new Set<string>();
  for (const match of decided) {
    if (!match.loserTeamId) continue;
    const role = groupRole(format, match.groupNumber);
    const knockedOut =
      role === 'main' ||
      role === 'third_place' ||
      role === 'losers' ||
      // The winners-bracket champion (opponent1) losing the first grand final forces a reset.
      (role === 'grand_final' && (match.roundNumber > 1 || !doubleGrandFinal || match.loserSlot !== 'opponent1'));
    if (knockedOut) eliminated.add(match.loserTeamId);
  }
  return eliminated;
}
