'use client';

import { useMemo } from 'react';
import type { Match, Group, Round } from 'brackets-model';
import type { Team } from '@/lib/types/team';
import type { BracketWithTeams } from '@/lib/types/bracket';
import { Status } from 'brackets-model';
import { MatchCard } from './match-card';
import { GROUP_NAMES } from '@/lib/types/bracket';

interface BracketViewProps {
  data: BracketWithTeams;
  onMatchClick?: (match: Match) => void;
}

interface MatchWithTeamInfo extends Match {
  team1?: Team;
  team2?: Team;
  lane_id?: string | null;
}

interface RoundWithMatches extends Round {
  matches: MatchWithTeamInfo[];
}

interface GroupWithRounds extends Group {
  rounds: RoundWithMatches[];
}

function getTeamForParticipant(
  participantId: number | null,
  participantTeamMap: Record<number, Team>
): Team | undefined {
  if (participantId === null) return undefined;
  return participantTeamMap[participantId];
}

function isByeMatch(match: Match): boolean {
  // BYE: opponent is literally `null` (not an object like {id:null})
  // TBD: opponent is an object like {id:null} or {id:null,position:X}
  const opp1IsLiterallyNull = match.opponent1 === null;
  const opp2IsLiterallyNull = match.opponent2 === null;

  // Hide if one opponent is null (BYE match)
  // Hide if both opponents are null (empty/unused match slot)
  return opp1IsLiterallyNull || opp2IsLiterallyNull;
}

function hasVisibleMatches(matches: Match[]): boolean {
  return matches.some((match) => !isByeMatch(match));
}

export function BracketView({ data, onMatchClick }: BracketViewProps) {
  const { bracket, participantTeamMap, laneMap = {} } = data;

  // Organize matches by group and round
  const groupsWithRounds = useMemo(() => {
    const result: GroupWithRounds[] = [];

    for (const group of bracket.groups) {
      const groupRounds: RoundWithMatches[] = [];

      const roundsInGroup = bracket.rounds.filter((r) => r.group_id === group.id);

      for (const round of roundsInGroup) {
        const matchesInRound = bracket.matches
          .filter((m) => m.round_id === round.id)
          .map((match) => {
            const opp1 = match.opponent1 as { id: number | null } | null;
            const opp2 = match.opponent2 as { id: number | null } | null;
            // Cast to access lane_id which is on the db record but not in brackets-model Match type
            const matchWithLane = match as Match & { lane_id?: string | null };

            return {
              ...match,
              team1: getTeamForParticipant(opp1?.id ?? null, participantTeamMap),
              team2: getTeamForParticipant(opp2?.id ?? null, participantTeamMap),
              lane_id: matchWithLane.lane_id,
            } as MatchWithTeamInfo;
          })
          .sort((a, b) => a.number - b.number);

        groupRounds.push({
          ...round,
          matches: matchesInRound,
        });
      }

      result.push({
        ...group,
        rounds: groupRounds.sort((a, b) => a.number - b.number),
      });
    }

    return result.sort((a, b) => a.number - b.number);
  }, [bracket, participantTeamMap]);

  const getRoundName = (group: GroupWithRounds, round: Round, visibleIndex: number): string => {
    // Get visible rounds for this group (rounds with at least one non-BYE match)
    const visibleRounds = group.rounds.filter((r) => hasVisibleMatches(r.matches));
    const totalVisibleRounds = visibleRounds.length;
    const displayRoundNumber = visibleIndex + 1;

    // For winner's bracket
    if (group.number === 1) {
      if (displayRoundNumber === totalVisibleRounds) {
        return 'WB Final';
      }
      if (displayRoundNumber === totalVisibleRounds - 1) {
        return 'WB Semifinal';
      }
      return `WB Round ${displayRoundNumber}`;
    }

    // For loser's bracket
    if (group.number === 2) {
      if (displayRoundNumber === totalVisibleRounds) {
        return 'LB Final';
      }
      return `LB Round ${displayRoundNumber}`;
    }

    // For grand final
    if (group.number === 3) {
      if (displayRoundNumber === 1) {
        return 'Grand Final';
      }
      return 'Grand Final Reset';
    }

    return `Round ${displayRoundNumber}`;
  };

  // Separate groups into main brackets (winners/losers) and grand final
  const mainBrackets = groupsWithRounds.filter((g) => g.number === 1 || g.number === 2);
  const grandFinal = groupsWithRounds.find((g) => g.number === 3);

  const renderGroup = (group: GroupWithRounds) => (
    <div key={group.id} className="space-y-4">
      <h2 className="text-lg font-semibold text-foreground">
        {GROUP_NAMES[group.number] || `Group ${group.number}`}
      </h2>

      <div className="overflow-x-auto pb-4">
        <div className="flex gap-6 min-w-max">
          {group.rounds
            .filter((round) => hasVisibleMatches(round.matches))
            .map((round, visibleIndex) => (
              <div key={round.id} className="flex flex-col gap-4">
                <div className="text-sm font-medium text-muted-foreground text-center">
                  {getRoundName(group, round, visibleIndex)}
                </div>

                <div className="flex flex-col gap-4 justify-around h-full">
                  {round.matches.map((match) =>
                    isByeMatch(match) ? (
                      // Invisible placeholder to preserve bracket spacing for BYE matches
                      <div key={match.id} className="w-56 h-[88px]" />
                    ) : (
                      <MatchCard
                        key={match.id}
                        match={match}
                        team1={match.team1}
                        team2={match.team2}
                        roundName={getRoundName(group, round, visibleIndex)}
                        laneLabel={match.lane_id ? laneMap[match.lane_id] : undefined}
                        onClick={() => onMatchClick?.(match)}
                        isClickable={
                          match.status === Status.Ready ||
                          match.status === Status.Running
                        }
                      />
                    )
                  )}
                </div>
              </div>
            ))}
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex gap-8">
      {/* Left side: Winners and Losers brackets stacked */}
      <div className="flex-1 space-y-8">
        {mainBrackets.map((group) => renderGroup(group))}
      </div>

      {/* Right side: Grand Final */}
      {grandFinal && (
        <div className="flex-shrink-0 flex flex-col justify-center">
          {renderGroup(grandFinal)}
        </div>
      )}
    </div>
  );
}
