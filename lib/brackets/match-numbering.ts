import { Status } from 'brackets-model';

interface NumberingMatch {
  id: number | string;
  round_id: number | string;
  number: number;
  status: number;
  opponent1: unknown;
  opponent2: unknown;
}

/**
 * A bye (one slot literally null, not `{ id: null }`), or an archived match that was
 * never played (the grand final reset when the winners-bracket champion won).
 */
export function isHiddenMatch(match: Pick<NumberingMatch, 'opponent1' | 'opponent2' | 'status'>): boolean {
  if (match.opponent1 === null || match.opponent2 === null) return true;
  if (match.status === Status.Archived) {
    const opp1 = match.opponent1 as { score?: number } | null;
    const opp2 = match.opponent2 as { score?: number } | null;
    return opp1?.score === undefined && opp2?.score === undefined;
  }
  return false;
}

/**
 * The M-number of every visible match: groups (winners, losers, finals), rounds and
 * matches in order.
 */
export function buildMatchNumbers(
  groups: ReadonlyArray<{ id: number | string; number: number }>,
  rounds: ReadonlyArray<{ id: number | string; group_id: number | string; number: number }>,
  matches: readonly NumberingMatch[]
): Map<number, number> {
  const numbers = new Map<number, number>();
  const ordered: NumberingMatch[] = [];
  for (const group of [...groups].sort((a, b) => a.number - b.number)) {
    const groupRounds = rounds
      .filter((r) => Number(r.group_id) === Number(group.id))
      .sort((a, b) => a.number - b.number);
    for (const round of groupRounds) {
      ordered.push(
        ...matches.filter((m) => Number(m.round_id) === Number(round.id)).sort((a, b) => a.number - b.number)
      );
    }
  }

  let next = 1;
  for (const match of ordered) {
    if (!isHiddenMatch(match)) numbers.set(Number(match.id), next++);
  }
  return numbers;
}
