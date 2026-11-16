import { Status } from 'brackets-model';
import type { BracketWithTeams } from '@/lib/types/bracket';
import type { EventStatus } from '@/lib/types/event';

export interface BracketProgress {
  played: number;
  total: number;
  lanesInPlay: number;
  lanesInMaintenance: number;
  lanes: Array<{ id: string; label: string; state: 'in_play' | 'open' | 'maintenance' }>;
  teams: number;
}

type Opponent = { id: number | null; result?: string } | null;

/**
 * Matches played out of matches that will be played. Byes (a null opponent) never
 * count. The grand-final reset counts only once the losers-bracket team has won the
 * first final: an unused reset keeps both teams but is archived unplayed.
 */
export function bracketProgress(data: BracketWithTeams): BracketProgress {
  const { groups, rounds, matches } = data.bracket;
  const finalGroup = groups.find((group) => group.number === 3);
  const finalRound = (number: number) =>
    finalGroup ? rounds.find((round) => round.group_id === finalGroup.id && round.number === number) : undefined;
  const firstFinalRound = finalRound(1);
  const resetRound = finalRound(2);
  const firstFinal = firstFinalRound ? matches.find((match) => match.round_id === firstFinalRound.id) : undefined;
  const resetNeeded = (firstFinal?.opponent2 as Opponent)?.result === 'win';

  let played = 0;
  let total = 0;
  for (const match of matches) {
    const a = match.opponent1 as Opponent;
    const b = match.opponent2 as Opponent;
    if (a === null || b === null) continue;
    if (resetRound && match.round_id === resetRound.id && !resetNeeded) continue;
    total += 1;
    const filled = a.id !== null && b.id !== null;
    if (filled && (match.status === Status.Completed || match.status === Status.Archived)) played += 1;
  }

  const lanes = [...data.lanes]
    .sort((x, y) => x.label.localeCompare(y.label, undefined, { numeric: true }))
    .map((lane) => ({
      id: lane.id,
      label: lane.label,
      state: lane.status === 'occupied' ? 'in_play' as const : lane.status === 'maintenance' ? 'maintenance' as const : 'open' as const,
    }));

  return {
    played,
    total,
    lanesInPlay: lanes.filter((lane) => lane.state === 'in_play').length,
    lanesInMaintenance: lanes.filter((lane) => lane.state === 'maintenance').length,
    lanes,
    teams: data.teams.length,
  };
}

export type HeaderStat = 'players' | 'pot' | 'lanes' | 'distance' | 'matches' | 'lanes_live' | 'teams';

/** The header numbers worth showing at each stage; money only when there is an entry fee. */
export function headerStats(event: { status: EventStatus; entry_fee_per_player: number | null }, isAdmin: boolean): HeaderStat[] {
  const pot: HeaderStat[] = isAdmin && event.entry_fee_per_player != null ? ['pot'] : [];
  switch (event.status) {
    case 'created':
    case 'pre-bracket':
      return ['players', ...pot, 'lanes', 'distance'];
    case 'bracket':
      return ['matches', 'lanes_live', 'teams', 'distance'];
    case 'completed':
      return ['players', ...pot, 'distance'];
  }
}
