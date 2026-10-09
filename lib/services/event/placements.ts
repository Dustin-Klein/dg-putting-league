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
  groups: PlacementGroup[];
  rounds: PlacementRound[];
  matches: PlacementMatch[];
  participants: PlacementParticipant[];
}

/** Pure bracket-to-placement calculation. Completed includes archived matches (4/5). */
export function computeEventPlacements({
  eventId,
  groups,
  rounds,
  matches,
  participants,
}: EventPlacementInput): ComputedEventPlacement[] {
  const completedMatches = matches.filter((match) => match.status === 4 || match.status === 5);
  const participantTeamMap = new Map(
    participants
      .filter((participant): participant is PlacementParticipant & { team_id: string } => participant.team_id !== null)
      .map((participant) => [participant.id, participant.team_id])
  );
  const placements: ComputedEventPlacement[] = [];
  const placedTeamIds = new Set<string>();

  const resultFor = (match: PlacementMatch): { winnerId?: string; loserId?: string } => {
    const opponent1Team = match.opponent1?.id == null
      ? undefined
      : participantTeamMap.get(match.opponent1.id);
    const opponent2Team = match.opponent2?.id == null
      ? undefined
      : participantTeamMap.get(match.opponent2.id);
    if (match.opponent1?.result === 'win') {
      return { winnerId: opponent1Team, loserId: opponent2Team };
    }
    if (match.opponent2?.result === 'win') {
      return { winnerId: opponent2Team, loserId: opponent1Team };
    }
    return {};
  };

  const add = (teamId: string | undefined): void => {
    if (!teamId || placedTeamIds.has(teamId)) return;
    placedTeamIds.add(teamId);
    placements.push({ eventId, teamId, placement: placements.length + 1 });
  };

  const grandFinalGroup = groups.find((group) => group.number === 3);
  if (grandFinalGroup) {
    const grandFinalRounds = rounds
      .filter((round) => round.group_id === grandFinalGroup.id)
      .sort((a, b) => b.number - a.number);
    for (const round of grandFinalRounds) {
      const roundMatches = completedMatches
        .filter((match) => match.round_id === round.id)
        .sort((a, b) => b.id - a.id);
      for (const match of roundMatches) {
        const result = resultFor(match);
        add(result.winnerId);
        add(result.loserId);
      }
    }
  }

  for (const groupNumber of [2, 1]) {
    const group = groups.find((candidate) => candidate.number === groupNumber);
    if (!group) continue;
    const groupRounds = rounds
      .filter((round) => round.group_id === group.id)
      .sort((a, b) => b.number - a.number);
    for (const round of groupRounds) {
      const losers = completedMatches
        .filter((match) => match.round_id === round.id)
        .map((match) => resultFor(match).loserId)
        .filter((teamId): teamId is string =>
          teamId !== undefined && !placedTeamIds.has(teamId)
        );
      for (const teamId of losers) add(teamId);
    }
  }

  return placements;
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
