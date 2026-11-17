import { type BracketFormat, groupRole } from './format';

export interface PlacementGroup {
  id: number;
  number: number;
}

export interface PlacementRound {
  id: number;
  group_id: number;
  number: number;
}

export interface PlacementOpponent {
  id?: number | null;
  result?: string;
}

export interface PlacementMatch {
  id: number;
  round_id: number;
  status: number;
  opponent1: PlacementOpponent | null;
  opponent2: PlacementOpponent | null;
}

export interface PlacementParticipant {
  id: number;
  team_id: string | null;
}

export interface ComputedEventPlacement {
  eventId: string;
  teamId: string;
  placement: number;
}

export interface EventPlacementInput {
  eventId: string;
  format?: BracketFormat;
  groups: PlacementGroup[];
  rounds: PlacementRound[];
  matches: PlacementMatch[];
  participants: PlacementParticipant[];
}

/** A completed match with a recorded result, reduced to what placement needs. */
export interface DecidedMatch {
  id: number;
  groupNumber: number;
  roundNumber: number;
  /** The highest-numbered round of its group in the generated structure. */
  isLastRoundOfGroup: boolean;
  winnerTeamId?: string;
  loserTeamId?: string;
}

/** A placement plus the match that decided it (the team's last win, or its eliminating loss). */
export interface DetailedPlacement extends ComputedEventPlacement {
  decidedBy: DecidedMatch;
  won: boolean;
}

/**
 * Placements from decided matches, best first; one distinct placement per team, so
 * losers of the same round are ordered by input order.
 *
 * Double elimination: grand-final teams (latest round first), then losers of the
 * losers bracket and winners bracket by descending round. Single elimination: the
 * final's winner and loser, the third-place match's winner and loser, then losers by
 * descending round.
 */
export function placeDecidedMatchesDetailed(
  eventId: string,
  format: BracketFormat,
  matches: readonly DecidedMatch[]
): DetailedPlacement[] {
  const placements: DetailedPlacement[] = [];
  const placed = new Set<string>();
  const add = (teamId: string | undefined, decidedBy: DecidedMatch, won: boolean): void => {
    if (!teamId || placed.has(teamId)) return;
    placed.add(teamId);
    placements.push({ eventId, teamId, placement: placements.length + 1, decidedBy, won });
  };
  const inRole = (role: ReturnType<typeof groupRole>) =>
    matches.filter((match) => groupRole(format, match.groupNumber) === role);
  const addWinnerThenLoser = (decided: readonly DecidedMatch[]) => {
    for (const match of [...decided].sort((a, b) => b.roundNumber - a.roundNumber || b.id - a.id)) {
      add(match.winnerTeamId, match, true);
      add(match.loserTeamId, match, false);
    }
  };
  const addLosersByRound = (decided: readonly DecidedMatch[]) => {
    const rounds = [...new Set(decided.map((match) => match.roundNumber))].sort((a, b) => b - a);
    for (const round of rounds) {
      for (const match of decided.filter((candidate) => candidate.roundNumber === round)) {
        add(match.loserTeamId, match, false);
      }
    }
  };

  if (format === 'single_elimination') {
    const main = inRole('main');
    addWinnerThenLoser(main.filter((match) => match.isLastRoundOfGroup));
    addWinnerThenLoser(inRole('third_place'));
    addLosersByRound(main);
  } else {
    addWinnerThenLoser(inRole('grand_final'));
    addLosersByRound(inRole('losers'));
    addLosersByRound(inRole('winners'));
  }
  return placements;
}

export function placeDecidedMatches(
  eventId: string,
  format: BracketFormat,
  matches: readonly DecidedMatch[]
): ComputedEventPlacement[] {
  return placeDecidedMatchesDetailed(eventId, format, matches)
    .map(({ eventId: id, teamId, placement }) => ({ eventId: id, teamId, placement }));
}

function isDecided(match: { status: number }): boolean {
  return match.status === 4 || match.status === 5;
}

/** Decided matches of a stored bracket. Completed includes archived matches (4/5). */
export function decidedMatchesOf({
  groups,
  rounds,
  matches,
  participants,
}: Omit<EventPlacementInput, 'eventId' | 'format'>): DecidedMatch[] {
  const teamByParticipant = new Map(
    participants
      .filter((participant): participant is PlacementParticipant & { team_id: string } => participant.team_id !== null)
      .map((participant) => [participant.id, participant.team_id])
  );
  const groupNumberById = new Map(groups.map((group) => [group.id, group.number]));
  const lastRoundByGroup = new Map<number, number>();
  for (const round of rounds) {
    lastRoundByGroup.set(round.group_id, Math.max(lastRoundByGroup.get(round.group_id) ?? 0, round.number));
  }
  const roundById = new Map(rounds.map((round) => [round.id, round]));

  const decided: DecidedMatch[] = [];
  for (const match of matches) {
    if (!isDecided(match)) continue;
    const round = roundById.get(match.round_id);
    const groupNumber = round ? groupNumberById.get(round.group_id) : undefined;
    if (!round || groupNumber === undefined) continue;
    const team = (opponent: PlacementOpponent | null) =>
      opponent?.id == null ? undefined : teamByParticipant.get(opponent.id);
    const opponent1Won = match.opponent1?.result === 'win';
    const opponent2Won = match.opponent2?.result === 'win';
    decided.push({
      id: match.id,
      groupNumber,
      roundNumber: round.number,
      isLastRoundOfGroup: lastRoundByGroup.get(round.group_id) === round.number,
      winnerTeamId: opponent1Won ? team(match.opponent1) : opponent2Won ? team(match.opponent2) : undefined,
      loserTeamId: opponent1Won ? team(match.opponent2) : opponent2Won ? team(match.opponent1) : undefined,
    });
  }
  return decided;
}

/** Pure bracket-to-placement calculation. */
export function computeEventPlacements({
  eventId,
  format = 'double_elimination',
  ...bracket
}: EventPlacementInput): ComputedEventPlacement[] {
  return placeDecidedMatches(eventId, format, decidedMatchesOf(bracket));
}

export interface GrandFinalMatch {
  roundNumber: number;
  status: number;
  opponent1: PlacementOpponent | null;
  opponent2: PlacementOpponent | null;
}

function hasRecordedResult(match: GrandFinalMatch | undefined): boolean {
  return Boolean(
    match &&
      (match.status === 4 || match.status === 5) &&
      (match.opponent1?.result === 'win' || match.opponent2?.result === 'win')
  );
}

/** Double elimination: decided once the grand final (and its reset, if needed) has a result. */
export function isBracketDecided(
  grandFinalMatches: GrandFinalMatch[],
  doubleGrandFinal: boolean
): boolean {
  const first = grandFinalMatches.find((match) => match.roundNumber === 1);
  if (!hasRecordedResult(first)) return false;
  if (doubleGrandFinal && first?.opponent2?.result === 'win') {
    return hasRecordedResult(grandFinalMatches.find((match) => match.roundNumber === 2));
  }
  return true;
}

/**
 * Single elimination: decided once the final and, if one was generated, the
 * third-place match have results. Reads the generated structure, not event settings.
 */
export function isSingleEliminationDecided(
  groups: PlacementGroup[],
  rounds: PlacementRound[],
  matches: PlacementMatch[]
): boolean {
  const main = groups.find((group) => groupRole('single_elimination', group.number) === 'main');
  if (!main) return false;
  const mainRounds = rounds.filter((round) => round.group_id === main.id);
  if (mainRounds.length === 0) return false;
  const finalRound = mainRounds.reduce((last, round) => (round.number > last.number ? round : last));
  const thirdPlaceGroupIds = new Set(
    groups.filter((group) => groupRole('single_elimination', group.number) === 'third_place').map((group) => group.id)
  );
  const thirdPlaceRoundIds = new Set(
    rounds.filter((round) => thirdPlaceGroupIds.has(round.group_id)).map((round) => round.id)
  );
  const required = matches.filter(
    (match) => match.round_id === finalRound.id || thirdPlaceRoundIds.has(match.round_id)
  );
  // A BYE slot is SQL NULL; such a match is never played (e.g. third place with three teams).
  const isBye = (match: PlacementMatch) => match.opponent1 === null || match.opponent2 === null;
  return required.length > 0 && required.every(
    (match) => isBye(match) || hasRecordedResult({ ...match, roundNumber: 0 })
  );
}
