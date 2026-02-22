'use client';

import React, { useMemo, useState, useEffect, Fragment } from 'react';
import type { Match, Group, Round } from 'brackets-model';
import type { Team } from '@/lib/types/team';
import type { BracketWithTeams } from '@/lib/types/bracket';
import type { EventStatus } from '@/lib/types/event';
import { Status } from 'brackets-model';
import { Eye, EyeOff } from 'lucide-react';
import { MatchCard } from './match-card';
import { GROUP_NAMES } from '@/lib/types/bracket';

interface BracketViewProps {
  data: BracketWithTeams;
  eventStatus?: EventStatus;
  onMatchClick?: (match: Match) => void;
  compact?: boolean;
  isEditMode?: boolean;
}

interface MatchWithTeamInfo extends Match {
  team1?: Team;
  team2?: Team;
  lane_id?: string | null;
  lane_assigned_at?: string | null;
}

interface RoundWithMatches extends Round {
  matches: MatchWithTeamInfo[];
}

interface GroupWithRounds extends Group {
  rounds: RoundWithMatches[];
}

interface MatchLayout {
  match: MatchWithTeamInfo;
  yPosition: number;
  visible: boolean;
}

interface RoundLayout {
  round: RoundWithMatches;
  matches: MatchLayout[];
  height: number;
}

const MATCH_HEIGHT = 66;
const MATCH_GAP = 16;
const BYE_GAP = 20;
const IDLE_THRESHOLD_MS = 120_000;

function isMatchIdleCandidate(match: MatchWithTeamInfo): boolean {
  return !!(
    match.lane_assigned_at &&
    match.status === Status.Ready &&
    match.opponent1 !== null &&
    match.opponent2 !== null &&
    (match.opponent1 as { id: number | null })?.id != null &&
    (match.opponent2 as { id: number | null })?.id != null
  );
}

function useIdleMatchIds(groups: GroupWithRounds[]): Set<number | string> {
  const [idleIds, setIdleIds] = useState<Set<number | string>>(new Set());

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;

    const evaluate = () => {
      const now = Date.now();
      const newIdleIds = new Set<number | string>();
      let soonestDelay = Infinity;

      for (const group of groups) {
        for (const round of group.rounds) {
          for (const match of round.matches) {
            if (!isMatchIdleCandidate(match)) continue;

            const assignedTime = new Date(match.lane_assigned_at!).getTime();
            if (Number.isNaN(assignedTime)) continue;

            const remaining = IDLE_THRESHOLD_MS - (now - assignedTime);
            if (remaining <= 0) {
              newIdleIds.add(match.id);
            } else {
              soonestDelay = Math.min(soonestDelay, remaining);
            }
          }
        }
      }

      setIdleIds(prev => {
        if (prev.size !== newIdleIds.size) return newIdleIds;
        for (const id of newIdleIds) {
          if (!prev.has(id)) return newIdleIds;
        }
        return prev;
      });

      if (soonestDelay < Infinity) {
        timer = setTimeout(evaluate, soonestDelay);
      }
    };

    evaluate();
    return () => clearTimeout(timer);
  }, [groups]);

  return idleIds;
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

function isHiddenMatch(match: Match, hideFinished: boolean): boolean {
  if (isByeMatch(match)) return true;
  if (hideFinished && (match.status === Status.Completed || match.status === Status.Archived)) return true;
  return false;
}

function hasVisibleMatches(matches: Match[], hideFinished = false): boolean {
  return matches.some((match) => !isHiddenMatch(match, hideFinished));
}

function getMatchCenter(layout: MatchLayout): number {
  if (layout.visible) {
    return layout.yPosition + MATCH_HEIGHT / 2;
  }
  return layout.yPosition + BYE_GAP / 2;
}

function calculateMidpoint(child1?: MatchLayout, child2?: MatchLayout): number {
  if (!child1 && !child2) return 0;
  if (!child1) {
    return getMatchCenter(child2!) - MATCH_HEIGHT / 2;
  }
  if (!child2) {
    return getMatchCenter(child1) - MATCH_HEIGHT / 2;
  }

  const c1Center = getMatchCenter(child1);
  const c2Center = getMatchCenter(child2);
  return (c1Center + c2Center) / 2 - MATCH_HEIGHT / 2;
}

function getChildLayouts(
  index: number,
  currentCount: number,
  prevLayouts: MatchLayout[]
): [MatchLayout | undefined, MatchLayout | undefined] {
  const isMinorRound = currentCount === prevLayouts.length;
  if (isMinorRound) {
    return [prevLayouts[index], undefined];
  }
  return [prevLayouts[index * 2], prevLayouts[index * 2 + 1]];
}

function calculateGroupLayout(group: GroupWithRounds, hideFinished = false): RoundLayout[] {
  const visibleRounds = group.rounds.filter(r => hasVisibleMatches(r.matches, hideFinished));
  if (visibleRounds.length === 0) return [];

  const layouts: RoundLayout[] = [];

  // Process first visible round - visible matches get full height, byes get reduced space
  const firstRound = visibleRounds[0];
  let currentY = 0;
  const firstRoundLayouts: MatchLayout[] = firstRound.matches.map(match => {
    const visible = !isHiddenMatch(match, hideFinished);
    const layout = { match, yPosition: currentY, visible };
    if (visible) {
      currentY += MATCH_HEIGHT + MATCH_GAP;
    } else {
      currentY += BYE_GAP;
    }
    return layout;
  });
  const firstRoundHeight = currentY > 0 ? currentY - (isHiddenMatch(firstRound.matches[firstRound.matches.length - 1], hideFinished) ? BYE_GAP : MATCH_GAP) : 0;
  layouts.push({
    round: firstRound,
    matches: firstRoundLayouts,
    height: firstRoundHeight
  });

  // Process subsequent rounds - position at midpoint of children
  for (let i = 1; i < visibleRounds.length; i++) {
    const round = visibleRounds[i];
    const prevLayout = layouts[i - 1];
    const roundLayouts: MatchLayout[] = [];

    for (let j = 0; j < round.matches.length; j++) {
      const match = round.matches[j];
      const visible = !isHiddenMatch(match, hideFinished);
      const [child1, child2] = getChildLayouts(j, round.matches.length, prevLayout.matches);
      const yPosition = calculateMidpoint(child1, child2);
      roundLayouts.push({ match, yPosition, visible });
    }

    // Enforce minimum spacing between visible matches to prevent overlap
    let lastVisibleBottom = -MATCH_GAP;
    for (const layout of roundLayouts) {
      if (layout.visible) {
        const minY = lastVisibleBottom + MATCH_GAP;
        if (layout.yPosition < minY) {
          layout.yPosition = minY;
        }
        lastVisibleBottom = layout.yPosition + MATCH_HEIGHT;
      }
    }

    const maxY = roundLayouts.reduce((max, l) =>
      l.visible ? Math.max(max, l.yPosition + MATCH_HEIGHT) : max, 0);

    layouts.push({ round, matches: roundLayouts, height: maxY });
  }

  // Normalize heights across all rounds to the maximum
  const totalHeight = Math.max(...layouts.map(l => l.height));
  layouts.forEach(l => l.height = totalHeight);

  return layouts;
}

function RoundConnector({
  leftLayouts,
  rightLayouts,
  totalHeight
}: {
  leftLayouts: MatchLayout[];
  rightLayouts: MatchLayout[];
  totalHeight: number;
}) {
  const isSingleMatch = leftLayouts.length === 1;

  if (isSingleMatch) {
    const left = leftLayouts[0];
    const right = rightLayouts[0];
    if (!left?.visible || !right?.visible) return <div className="w-9" style={{ height: totalHeight }} />;

    const leftCenter = getMatchCenter(left);
    const rightCenter = getMatchCenter(right);

    return (
      <div className="relative w-9 mx-0" style={{ height: totalHeight }}>
        <svg className="absolute inset-0 w-full h-full overflow-visible">
          <line
            x1="0" y1={leftCenter}
            x2="36" y2={rightCenter}
            stroke="currentColor"
            strokeWidth="2"
            className="text-muted-foreground/40"
          />
        </svg>
      </div>
    );
  }

  const connectorPaths: React.JSX.Element[] = [];

  for (let j = 0; j < rightLayouts.length; j++) {
    const right = rightLayouts[j];
    if (!right?.visible) continue;

    const [child1, child2] = getChildLayouts(j, rightLayouts.length, leftLayouts);

    const rightCenter = getMatchCenter(right);

    if (child1?.visible) {
      const child1Center = getMatchCenter(child1);
      connectorPaths.push(
        <path
          key={`${j}-top`}
          d={`M 0 ${child1Center} H 12 V ${rightCenter} H 36`}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="text-muted-foreground/40"
        />
      );
    }

    if (child2?.visible) {
      const child2Center = getMatchCenter(child2);
      connectorPaths.push(
        <path
          key={`${j}-bottom`}
          d={`M 0 ${child2Center} H 12 V ${rightCenter} H 36`}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="text-muted-foreground/40"
        />
      );
    }
  }

  return (
    <div className="relative w-9 mx-0" style={{ height: totalHeight }}>
      <svg className="absolute inset-0 w-full h-full overflow-visible">
        {connectorPaths}
      </svg>
    </div>
  );
}

export function BracketView({ data, eventStatus, onMatchClick, compact = false, isEditMode = false }: BracketViewProps) {
  const { bracket, participantTeamMap, laneMap = {}, bracketFrameCount, frameCountMap = {} } = data;
  const [hideFinished, setHideFinished] = useState(() => {
    if (typeof window !== 'undefined') {
      return sessionStorage.getItem('bracket-hide-finished') === 'true';
    }
    return false;
  });

  useEffect(() => {
    sessionStorage.setItem('bracket-hide-finished', String(hideFinished));
  }, [hideFinished]);

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
            const matchWithLane = match as Match & { lane_id?: string | null; lane_assigned_at?: string | null };

            return {
              ...match,
              team1: getTeamForParticipant(opp1?.id ?? null, participantTeamMap),
              team2: getTeamForParticipant(opp2?.id ?? null, participantTeamMap),
              lane_id: matchWithLane.lane_id,
              lane_assigned_at: matchWithLane.lane_assigned_at,
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

  const getRoundName = (group: GroupWithRounds, round: Round): string => {
    // Use stable labels based on all non-BYE rounds (not affected by hideFinished)
    const labelRounds = group.rounds.filter((r) => hasVisibleMatches(r.matches, false));
    const labelIndex = labelRounds.findIndex((r) => r.id === round.id);
    const totalVisibleRounds = labelRounds.length;
    const displayRoundNumber = labelIndex + 1;

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

  const idleMatchIds = useIdleMatchIds(groupsWithRounds);

  // Separate groups into main brackets (winners/losers) and grand final
  const winnersBracket = groupsWithRounds.find((g) => g.number === 1);
  const losersBracket = groupsWithRounds.find((g) => g.number === 2);
  const grandFinal = groupsWithRounds.find((g) => g.number === 3);

  const renderGroup = (group: GroupWithRounds) => {
    const roundLayouts = calculateGroupLayout(group, hideFinished);
    if (roundLayouts.length === 0) return null;

    const totalHeight = roundLayouts[0]?.height || 0;

    return (
      <div key={group.id} className={compact ? 'space-y-1' : 'space-y-4'}>
        <h2 className={`font-semibold text-foreground ${compact ? 'text-base' : 'text-lg'}`}>
          {GROUP_NAMES[group.number] || `Group ${group.number}`}
        </h2>

        <div className={compact ? 'pb-1' : 'pb-4'}>
          {/* Round headers row */}
          <div className={`flex min-w-max ${compact ? 'mb-2' : 'mb-4'}`}>
            {roundLayouts.map((layout, idx) => (
              <Fragment key={layout.round.id}>
                <div className="w-64 text-sm font-medium text-muted-foreground text-center">
                  {getRoundName(group, layout.round)}
                </div>
                {idx < roundLayouts.length - 1 && (
                  <div className="w-9" />
                )}
              </Fragment>
            ))}
          </div>
          {/* Matches and connectors row */}
          <div className="flex min-w-max items-start">
            {roundLayouts.map((layout, idx) => (
              <Fragment key={layout.round.id}>
                <div className="relative w-64" style={{ height: totalHeight }}>
                  {layout.matches.map(({ match, yPosition, visible }) =>
                    visible && (
                      <div
                        key={match.id}
                        className="absolute left-0 right-0"
                        style={{ top: yPosition }}
                      >
                        <MatchCard
                          match={match}
                          team1={match.team1}
                          team2={match.team2}
                          matchNumber={matchNumberMap.get(match.id) || 0}
                          laneLabel={match.lane_id ? laneMap[match.lane_id] : undefined}
                          isIdle={idleMatchIds.has(match.id)}
                          onClick={() => onMatchClick?.(match)}
                          isClickable={
                            !!onMatchClick && (
                              match.status === Status.Ready ||
                              match.status === Status.Running ||
                              (eventStatus === 'bracket' &&
                                (match.status === Status.Completed || match.status === Status.Archived)) ||
                              (isEditMode && eventStatus === 'bracket' &&
                                (match.status === Status.Waiting || match.status === Status.Locked))
                            )
                          }
                          isCorrectionMode={
                            !!onMatchClick &&
                            eventStatus === 'bracket' &&
                            (match.status === Status.Completed || match.status === Status.Archived)
                          }
                          framesCompleted={frameCountMap[match.id as number]}
                          totalFrames={bracketFrameCount}
                        />
                      </div>
                    )
                  )}
                </div>
                {idx < roundLayouts.length - 1 && (
                  <RoundConnector
                    leftLayouts={layout.matches}
                    rightLayouts={roundLayouts[idx + 1].matches}
                    totalHeight={totalHeight}
                  />
                )}
              </Fragment>
            ))}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className={compact ? 'space-y-2' : 'space-y-8'}>
      <button
        type="button"
        onClick={() => setHideFinished(prev => !prev)}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        {hideFinished ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        {hideFinished ? 'Show finished' : 'Hide finished'}
      </button>
      {/* Winners bracket + Grand Final side by side, vertically centered */}
      <div className={`flex items-center ${compact ? 'gap-4' : 'gap-8'}`}>
        {winnersBracket && renderGroup(winnersBracket)}
        {grandFinal && renderGroup(grandFinal)}
      </div>

      {/* Losers bracket below */}
      {losersBracket && renderGroup(losersBracket)}
    </div>
  );
}
