'use client';

import { useMemo, Fragment } from 'react';
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

interface MatchPosition {
  matchId: number | string;
  yPosition: number;
  height: number;
}

interface RoundLayout {
  roundId: number | string;
  positions: MatchPosition[];
  totalHeight: number;
}

const MATCH_HEIGHT = 88;
const MATCH_GAP = 24;
const MATCH_SLOT = MATCH_HEIGHT + MATCH_GAP;

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

function calculateGroupLayout(rounds: RoundWithMatches[]): Map<number | string, RoundLayout> {
  const visibleRounds = rounds.filter((r) => hasVisibleMatches(r.matches));
  if (visibleRounds.length === 0) return new Map();

  // Find the anchor round: the one with most non-BYE matches
  let anchorRoundIndex = 0;
  let maxNonByeMatches = 0;
  visibleRounds.forEach((round, index) => {
    const nonByeCount = round.matches.filter((m) => !isByeMatch(m)).length;
    if (nonByeCount > maxNonByeMatches) {
      maxNonByeMatches = nonByeCount;
      anchorRoundIndex = index;
    }
  });

  const layoutMap = new Map<number | string, RoundLayout>();

  // Calculate anchor round layout - stack matches sequentially
  const anchorRound = visibleRounds[anchorRoundIndex];
  const anchorPositions: MatchPosition[] = [];
  let yPos = 0;
  for (const match of anchorRound.matches) {
    if (!isByeMatch(match)) {
      anchorPositions.push({
        matchId: match.id,
        yPosition: yPos,
        height: MATCH_HEIGHT,
      });
      yPos += MATCH_SLOT;
    }
  }
  layoutMap.set(anchorRound.id, {
    roundId: anchorRound.id,
    positions: anchorPositions,
    totalHeight: 0,
  });

  // Work backwards from anchor to earlier rounds
  for (let i = anchorRoundIndex - 1; i >= 0; i--) {
    const currentRound = visibleRounds[i];
    const nextRound = visibleRounds[i + 1];
    const nextLayout = layoutMap.get(nextRound.id)!;

    const positions = calculateEarlierRoundPositions(currentRound, nextRound, nextLayout);
    layoutMap.set(currentRound.id, {
      roundId: currentRound.id,
      positions,
      totalHeight: 0,
    });
  }

  // Work forwards from anchor to later rounds
  for (let i = anchorRoundIndex + 1; i < visibleRounds.length; i++) {
    const currentRound = visibleRounds[i];
    const prevRound = visibleRounds[i - 1];
    const prevLayout = layoutMap.get(prevRound.id)!;

    const positions = calculateLaterRoundPositions(currentRound, prevRound, prevLayout);
    layoutMap.set(currentRound.id, {
      roundId: currentRound.id,
      positions,
      totalHeight: 0,
    });
  }

  // Normalize positions: find minimum Y across all rounds and shift everything
  let minY = 0;
  let maxY = 0;
  for (const layout of layoutMap.values()) {
    for (const pos of layout.positions) {
      minY = Math.min(minY, pos.yPosition);
      maxY = Math.max(maxY, pos.yPosition + MATCH_HEIGHT);
    }
  }

  // Shift all positions so minimum is 0
  const shift = -minY;
  for (const layout of layoutMap.values()) {
    for (const pos of layout.positions) {
      pos.yPosition += shift;
    }
  }

  // Calculate total height
  const totalHeight = maxY - minY;

  // Update totalHeight for all layouts
  for (const layout of layoutMap.values()) {
    layout.totalHeight = totalHeight;
  }

  return layoutMap;
}

function calculateEarlierRoundPositions(
  currentRound: RoundWithMatches,
  nextRound: RoundWithMatches,
  nextLayout: RoundLayout
): MatchPosition[] {
  const positions: MatchPosition[] = [];
  const nextPositionsByIndex = new Map<number, MatchPosition>();

  // Index next round's visible matches
  let visibleIndex = 0;
  for (const match of nextRound.matches) {
    if (!isByeMatch(match)) {
      const pos = nextLayout.positions.find((p) => p.matchId === match.id);
      if (pos) {
        nextPositionsByIndex.set(visibleIndex, pos);
        visibleIndex++;
      }
    }
  }

  // Each pair of matches in current round feeds into one match in next round
  let currentMatchIndex = 0;
  let visibleMatchIndex = 0;

  for (const match of currentRound.matches) {
    if (!isByeMatch(match)) {
      // This match and its pair feed into target match at floor(currentMatchIndex/2)
      const targetMatchIndex = Math.floor(currentMatchIndex / 2);
      const targetPos = nextPositionsByIndex.get(targetMatchIndex);

      if (targetPos) {
        const targetCenter = targetPos.yPosition + MATCH_HEIGHT / 2;

        // Check if pair match exists and is visible
        const pairIndex = currentMatchIndex % 2 === 0 ? currentMatchIndex + 1 : currentMatchIndex - 1;
        const pairMatch = currentRound.matches[pairIndex];
        const pairIsVisible = pairMatch && !isByeMatch(pairMatch);

        let yPosition: number;
        if (!pairIsVisible) {
          // No pair - position directly at target center
          yPosition = targetCenter - MATCH_HEIGHT / 2;
        } else {
          // Has pair - position based on whether we're top or bottom of pair
          const isTop = currentMatchIndex % 2 === 0;
          const offset = MATCH_SLOT / 2;
          yPosition = isTop
            ? targetCenter - offset - MATCH_HEIGHT / 2
            : targetCenter + offset - MATCH_HEIGHT / 2;
        }

        positions.push({
          matchId: match.id,
          yPosition,
          height: MATCH_HEIGHT,
        });
      }
      visibleMatchIndex++;
    }
    currentMatchIndex++;
  }

  return positions;
}

function calculateLaterRoundPositions(
  currentRound: RoundWithMatches,
  prevRound: RoundWithMatches,
  prevLayout: RoundLayout
): MatchPosition[] {
  const positions: MatchPosition[] = [];

  // Index prev round's visible matches with their positions
  const prevPositions: { match: MatchWithTeamInfo; pos: MatchPosition }[] = [];
  for (const match of prevRound.matches) {
    if (!isByeMatch(match)) {
      const pos = prevLayout.positions.find((p) => p.matchId === match.id);
      if (pos) {
        prevPositions.push({ match, pos });
      }
    }
  }

  const currentVisibleMatches = currentRound.matches.filter((m) => !isByeMatch(m));
  const prevVisibleCount = prevPositions.length;
  const currentVisibleCount = currentVisibleMatches.length;

  // Detect if this is a 1:1 mapping (losers bracket with WB dropouts)
  // When current round has same or more matches than prev, it's 1:1 alignment
  const isOneToOne = currentVisibleCount >= prevVisibleCount;

  let currentVisibleIndex = 0;
  for (const match of currentRound.matches) {
    if (!isByeMatch(match)) {
      let yPosition: number;

      if (isOneToOne) {
        // 1:1 alignment - each match aligns with corresponding prev match
        const source = prevPositions[currentVisibleIndex];
        if (source) {
          yPosition = source.pos.yPosition;
        } else {
          // No source - stack below previous matches
          const lastPrevPos = prevPositions[prevPositions.length - 1];
          const baseY = lastPrevPos ? lastPrevPos.pos.yPosition + MATCH_SLOT : 0;
          const extraIndex = currentVisibleIndex - prevVisibleCount;
          yPosition = baseY + extraIndex * MATCH_SLOT;
        }
      } else {
        // 2:1 reduction - each match receives from pair in prev round
        const sourceIndex1 = currentVisibleIndex * 2;
        const sourceIndex2 = currentVisibleIndex * 2 + 1;

        const source1 = prevPositions[sourceIndex1];
        const source2 = prevPositions[sourceIndex2];

        if (source1 && source2) {
          // Both sources exist - position at midpoint
          const center1 = source1.pos.yPosition + MATCH_HEIGHT / 2;
          const center2 = source2.pos.yPosition + MATCH_HEIGHT / 2;
          yPosition = (center1 + center2) / 2 - MATCH_HEIGHT / 2;
        } else if (source1) {
          yPosition = source1.pos.yPosition;
        } else if (source2) {
          yPosition = source2.pos.yPosition;
        } else {
          yPosition = currentVisibleIndex * MATCH_SLOT;
        }
      }

      positions.push({
        matchId: match.id,
        yPosition,
        height: MATCH_HEIGHT,
      });

      currentVisibleIndex++;
    }
  }

  return positions;
}

interface ConnectorProps {
  currentRound: RoundWithMatches;
  nextRound: RoundWithMatches;
  currentLayout: RoundLayout;
  nextLayout: RoundLayout;
  totalHeight: number;
}

function RoundConnector({
  currentRound,
  nextRound,
  currentLayout,
  nextLayout,
  totalHeight,
}: ConnectorProps) {
  // Build position lookups
  const currentPositionMap = new Map<number | string, MatchPosition>();
  for (const pos of currentLayout.positions) {
    currentPositionMap.set(pos.matchId, pos);
  }
  const nextPositionMap = new Map<number | string, MatchPosition>();
  for (const pos of nextLayout.positions) {
    nextPositionMap.set(pos.matchId, pos);
  }

  // Get visible matches in order
  const currentVisible = currentRound.matches.filter((m) => !isByeMatch(m));
  const nextVisible = nextRound.matches.filter((m) => !isByeMatch(m));

  // Special case: single match to single match (like grand final to reset)
  const isSingleToSingle = currentVisible.length === 1 && nextVisible.length === 1;

  if (isSingleToSingle) {
    const sourcePos = currentPositionMap.get(currentVisible[0].id);
    const targetPos = nextPositionMap.get(nextVisible[0].id);
    if (sourcePos && targetPos) {
      const sourceY = sourcePos.yPosition + MATCH_HEIGHT / 2;
      return (
        <div className="relative w-6 mx-2" style={{ height: totalHeight }}>
          <svg className="absolute inset-0 w-full h-full overflow-visible">
            <line
              x1="0"
              y1={sourceY}
              x2="24"
              y2={sourceY}
              stroke="currentColor"
              strokeWidth="2"
              className="text-muted-foreground/40"
            />
          </svg>
        </div>
      );
    }
  }

  // Build connector paths: each pair of current matches connects to one next match
  const paths: React.ReactNode[] = [];
  let currentIndex = 0;

  for (let targetIndex = 0; targetIndex < nextVisible.length; targetIndex++) {
    const targetMatch = nextVisible[targetIndex];
    const targetPos = nextPositionMap.get(targetMatch.id);
    if (!targetPos) continue;

    const targetY = targetPos.yPosition + MATCH_HEIGHT / 2;

    // Get the two source matches (or fewer if at end)
    const source1 = currentVisible[currentIndex];
    const source2 = currentVisible[currentIndex + 1];

    const source1Pos = source1 ? currentPositionMap.get(source1.id) : undefined;
    const source2Pos = source2 ? currentPositionMap.get(source2.id) : undefined;

    if (source1Pos && source2Pos) {
      // Both sources - draw bracket shape
      const y1 = source1Pos.yPosition + MATCH_HEIGHT / 2;
      const y2 = source2Pos.yPosition + MATCH_HEIGHT / 2;
      paths.push(
        <g key={`pair-${targetIndex}`}>
          {/* Top horizontal line */}
          <line x1="0" y1={y1} x2="12" y2={y1} stroke="currentColor" strokeWidth="2" className="text-muted-foreground/40" />
          {/* Vertical line connecting top and bottom */}
          <line x1="12" y1={y1} x2="12" y2={y2} stroke="currentColor" strokeWidth="2" className="text-muted-foreground/40" />
          {/* Bottom horizontal line */}
          <line x1="0" y1={y2} x2="12" y2={y2} stroke="currentColor" strokeWidth="2" className="text-muted-foreground/40" />
          {/* Output horizontal line to target */}
          <line x1="12" y1={targetY} x2="24" y2={targetY} stroke="currentColor" strokeWidth="2" className="text-muted-foreground/40" />
        </g>
      );
      currentIndex += 2;
    } else if (source1Pos) {
      // Only top source - straight line
      const y1 = source1Pos.yPosition + MATCH_HEIGHT / 2;
      paths.push(
        <line
          key={`single-${targetIndex}`}
          x1="0"
          y1={y1}
          x2="24"
          y2={targetY}
          stroke="currentColor"
          strokeWidth="2"
          className="text-muted-foreground/40"
        />
      );
      currentIndex += 1;
    } else if (source2Pos) {
      // Only bottom source - straight line
      const y2 = source2Pos.yPosition + MATCH_HEIGHT / 2;
      paths.push(
        <line
          key={`single-${targetIndex}`}
          x1="0"
          y1={y2}
          x2="24"
          y2={targetY}
          stroke="currentColor"
          strokeWidth="2"
          className="text-muted-foreground/40"
        />
      );
      currentIndex += 1;
    }
  }

  return (
    <div className="relative w-6 mx-2" style={{ height: totalHeight }}>
      <svg className="absolute inset-0 w-full h-full overflow-visible">
        {paths}
      </svg>
    </div>
  );
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
  const mainBrackets = groupsWithRounds.filter((g) => g.number === 1 || g.number === 2);
  const grandFinal = groupsWithRounds.find((g) => g.number === 3);

  const renderGroup = (group: GroupWithRounds) => {
    const layoutMap = calculateGroupLayout(group.rounds);
    const visibleRounds = group.rounds.filter((round) => hasVisibleMatches(round.matches));
    const totalHeight = visibleRounds.length > 0
      ? layoutMap.get(visibleRounds[0].id)?.totalHeight ?? MATCH_HEIGHT
      : MATCH_HEIGHT;

    return (
      <div key={group.id} className="space-y-4">
        <h2 className="text-lg font-semibold text-foreground">
          {GROUP_NAMES[group.number] || `Group ${group.number}`}
        </h2>

        <div className="overflow-x-auto pb-4">
          {/* Round headers row */}
          <div className="flex min-w-max mb-4">
            {visibleRounds.map((round, visibleIndex) => (
              <Fragment key={round.id}>
                <div className="w-56 text-sm font-medium text-muted-foreground text-center">
                  {getRoundName(group, round, visibleIndex)}
                </div>
                {visibleIndex < visibleRounds.length - 1 && (
                  <div className="w-9" /> // Spacer for connector width
                )}
              </Fragment>
            ))}
          </div>
          {/* Matches and connectors row */}
          <div className="flex min-w-max items-start">
            {visibleRounds.map((round, visibleIndex) => {
              const roundLayout = layoutMap.get(round.id);
              if (!roundLayout) return null;

              return (
                <Fragment key={round.id}>
                  <div className="relative w-56" style={{ height: totalHeight }}>
                    {roundLayout.positions.map((pos) => {
                      const match = round.matches.find((m) => m.id === pos.matchId);
                      if (!match) return null;

                      return (
                        <div
                          key={match.id}
                          className="absolute w-56"
                          style={{ top: pos.yPosition }}
                        >
                          <MatchCard
                            match={match}
                            team1={match.team1}
                            team2={match.team2}
                            matchNumber={matchNumberMap.get(match.id) || 0}
                            laneLabel={match.lane_id ? laneMap[match.lane_id] : undefined}
                            onClick={() => onMatchClick?.(match)}
                            isClickable={
                              match.status === Status.Ready ||
                              match.status === Status.Running
                            }
                          />
                        </div>
                      );
                    })}
                  </div>
                  {/* Add connector lines between rounds (not after last round) */}
                  {visibleIndex < visibleRounds.length - 1 && (
                    <RoundConnector
                      currentRound={round}
                      nextRound={visibleRounds[visibleIndex + 1]}
                      currentLayout={roundLayout}
                      nextLayout={layoutMap.get(visibleRounds[visibleIndex + 1].id)!}
                      totalHeight={totalHeight}
                    />
                  )}
                </Fragment>
              );
            })}
          </div>
        </div>
      </div>
    );
  };

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
