'use client';

import { useMemo, Fragment } from 'react';
import type { Match, Group, Round } from 'brackets-model';
import type { Team } from '@/lib/types/team';
import type { BracketWithTeams } from '@/lib/types/bracket';
import type { EventStatus } from '@/lib/types/event';
import { Status } from 'brackets-model';
import { MatchCard } from './match-card';
import { GROUP_NAMES } from '@/lib/types/bracket';

interface BracketViewProps {
  data: BracketWithTeams;
  eventStatus?: EventStatus;
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
  if (opp1IsLiterallyNull || opp2IsLiterallyNull) {
    return true;
  }

  // Hide archived matches that were never played (no scores recorded)
  // This handles the grand final reset match when WB champion wins the first GF
  if (match.status === Status.Archived) {
    const opp1 = match.opponent1 as { score?: number } | null;
    const opp2 = match.opponent2 as { score?: number } | null;
    const hasScores = opp1?.score !== undefined || opp2?.score !== undefined;
    if (!hasScores) {
      return true;
    }
  }

  return false;
}

function hasVisibleMatches(matches: Match[]): boolean {
  return matches.some((match) => !isByeMatch(match));
}

// Connector component to draw lines between rounds
function RoundConnector({ matches }: { matches: Match[] }) {
  // Match card height (~66px) + gap (16px) = ~82px per match slot
  const halfHeight = 41;

  // Group matches into pairs for connectors
  const connectors: Array<{ top: boolean; bottom: boolean }> = [];

  for (let i = 0; i < matches.length; i += 2) {
    const topMatch = matches[i];
    const bottomMatch = matches[i + 1];
    const topVisible = topMatch && !isByeMatch(topMatch);
    const bottomVisible = bottomMatch && !isByeMatch(bottomMatch);
    connectors.push({ top: topVisible, bottom: Boolean(bottomMatch) && bottomVisible });
  }

  // Special case: single match (like grand final to reset)
  const isSingleMatch = matches.length === 1;

  return (
    <div className="flex flex-col justify-around mx-2">
      {isSingleMatch ? (
        // Single straight line for 1-to-1 connections
        !isByeMatch(matches[0]) && (
          <div className="flex items-center">
            <div className="w-6 border-t-2 border-muted-foreground/40" />
          </div>
        )
      ) : (
        connectors.map((connector, i) => {
          // Skip if neither match is visible
          if (!connector.top && !connector.bottom) {
            return <div key={i} style={{ height: halfHeight * 2 }} />;
          }

          return (
            <div key={i} className="flex items-center">
              <div className="flex flex-col w-3">
                {/* Top half - only show border if top match is visible */}
                <div
                  className={connector.top
                    ? "border-t-2 border-r-2 border-muted-foreground/40 rounded-tr-sm"
                    : ""
                  }
                  style={{ height: halfHeight }}
                />
                {/* Bottom half - only show border if bottom match is visible */}
                <div
                  className={connector.bottom
                    ? "border-b-2 border-r-2 border-muted-foreground/40 rounded-br-sm"
                    : ""
                  }
                  style={{ height: halfHeight }}
                />
              </div>
              {(connector.top || connector.bottom) && (
                <div className="w-3 border-t-2 border-muted-foreground/40" />
              )}
            </div>
          );
        })
      )}
    </div>
  );
}

export function BracketView({ data, eventStatus, onMatchClick }: BracketViewProps) {
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

  // Compute sequential match numbers for visible matches across all groups
  const matchNumberMap = useMemo(() => {
    const map = new Map<number | string, number>();
    let matchNumber = 1;

    // Process groups in order (winners, losers, grand final)
    for (const group of groupsWithRounds) {
      for (const round of group.rounds) {
        for (const match of round.matches) {
          if (!isByeMatch(match)) {
            map.set(match.id, matchNumber++);
          }
        }
      }
    }

    return map;
  }, [groupsWithRounds]);

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
  const winnersBracket = groupsWithRounds.find((g) => g.number === 1);
  const losersBracket = groupsWithRounds.find((g) => g.number === 2);
  const grandFinal = groupsWithRounds.find((g) => g.number === 3);

  const renderGroup = (group: GroupWithRounds) => (
    <div key={group.id} className="space-y-4">
      <h2 className="text-lg font-semibold text-foreground">
        {GROUP_NAMES[group.number] || `Group ${group.number}`}
      </h2>

      <div className="pb-4">
        {/* Round headers row */}
        <div className="flex min-w-max mb-4">
          {group.rounds
            .filter((round) => hasVisibleMatches(round.matches))
            .map((round, visibleIndex, visibleRounds) => (
              <Fragment key={round.id}>
                <div className="w-64 text-sm font-medium text-muted-foreground text-center">
                  {getRoundName(group, round, visibleIndex)}
                </div>
                {visibleIndex < visibleRounds.length - 1 && (
                  <div className="w-9" /> // Spacer for connector width
                )}
              </Fragment>
            ))}
        </div>
        {/* Matches and connectors row */}
        <div className="flex min-w-max items-stretch">
          {group.rounds
            .filter((round) => hasVisibleMatches(round.matches))
            .map((round, visibleIndex, visibleRounds) => (
              <Fragment key={round.id}>
                <div className="flex flex-col gap-4 justify-around">
                  {round.matches.map((match) =>
                    isByeMatch(match) ? (
                      // Invisible placeholder to preserve bracket spacing for BYE matches
                      <div key={match.id} className="w-64 h-[66px]" />
                    ) : (
                      <MatchCard
                        key={match.id}
                        match={match}
                        team1={match.team1}
                        team2={match.team2}
                        matchNumber={matchNumberMap.get(match.id) || 0}
                        laneLabel={match.lane_id ? laneMap[match.lane_id] : undefined}
                        onClick={() => onMatchClick?.(match)}
                        isClickable={
                          match.status === Status.Ready ||
                          match.status === Status.Running ||
                          (eventStatus === 'bracket' &&
                            (match.status === Status.Completed || match.status === Status.Archived))
                        }
                        isCorrectionMode={
                          eventStatus === 'bracket' &&
                          (match.status === Status.Completed || match.status === Status.Archived)
                        }
                      />
                    )
                  )}
                </div>
                {/* Add connector lines between rounds (not after last round) */}
                {visibleIndex < visibleRounds.length - 1 && (
                  <RoundConnector matches={round.matches} />
                )}
              </Fragment>
            ))}
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-8">
      {/* Winners bracket + Grand Final side by side, vertically centered */}
      <div className="flex items-center gap-8">
        {winnersBracket && renderGroup(winnersBracket)}
        {grandFinal && renderGroup(grandFinal)}
      </div>

      {/* Losers bracket below */}
      {losersBracket && renderGroup(losersBracket)}
    </div>
  );
}
