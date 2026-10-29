'use client';

import { cn } from '@/lib/utils/utils';
import { sortBySlot } from '@/lib/utils/team-utils';
import { Badge } from '@/components/ui/badge';
import { ScoreStepperRow } from '@/app/score/components/scoring-wizard/score-stepper-row';
import { ZoneBadge } from '@/components/zone-badge';
import { getResolvedScore } from '@/app/score/components/scoring-wizard/scoring-utils';
import {
  calculatePoints,
  getScoreKey,
  type MatchInfo,
  type PlayerInfo,
  type ScoreState,
  type TeamInfo,
} from './wizard-types';

interface TeamScoringSectionProps {
  team: TeamInfo;
  teamNumber: 1 | 2;
  frameNumber: number;
  match: MatchInfo;
  localScores: ScoreState;
  bonusPointEnabled: boolean;
  onScoreChange: (eventPlayerId: string, frameNumber: number, puttsMade: number) => void;
}

export function TeamScoringSection({
  team,
  teamNumber,
  frameNumber,
  match,
  localScores,
  bonusPointEnabled,
  onScoreChange,
}: TeamScoringSectionProps) {
  const bgColor =
    teamNumber === 1
      ? 'bg-team-1/5 border-l-4 border-team-1'
      : 'bg-team-2/5 border-l-4 border-team-2';
  const headerBorder =
    teamNumber === 1
      ? 'border-b border-team-1/40'
      : 'border-b border-team-2/40';

  const frame = match.frames.find((item) => item.frame_number === frameNumber);
  let frameScore = 0;

  for (const player of team.players) {
    const key = getScoreKey(player.event_player_id, frameNumber);
    const localScore = localScores.get(key);
    const putts =
      localScore ?? frame?.results.find((result) => result.event_player_id === player.event_player_id)?.putts_made;

    if (putts !== undefined) {
      frameScore += calculatePoints(putts, bonusPointEnabled);
    }
  }

  return (
    <div className={cn('rounded-lg p-2', bgColor)}>
      <div className={cn('flex items-center justify-between pb-2 mb-2', headerBorder)}>
        <span
          className={cn(
            'text-xs font-semibold',
            teamNumber === 1 ? 'text-team-1-ink' : 'text-team-2-ink'
          )}
        >
          Team {teamNumber}
          <span className="mx-1.5 font-light opacity-40">|</span>
          <span className="font-normal text-muted-foreground">
            #{team.seed} {team.pool_combo}
          </span>
        </span>
        <Badge variant="secondary" className="font-mono text-xs h-5">
          {frameScore} pts
        </Badge>
      </div>
      <div className="space-y-2">
        {sortBySlot(team.players).map((player) => (
          <MatchPlayerScoreRow
            key={player.event_player_id}
            player={player}
            frameNumber={frameNumber}
            match={match}
            localScores={localScores}
            bonusPointEnabled={bonusPointEnabled}
            onScoreChange={onScoreChange}
          />
        ))}
      </div>
    </div>
  );
}

interface MatchPlayerScoreRowProps {
  player: PlayerInfo;
  frameNumber: number;
  match: MatchInfo;
  localScores: ScoreState;
  bonusPointEnabled: boolean;
  onScoreChange: (eventPlayerId: string, frameNumber: number, puttsMade: number) => void;
}

function MatchPlayerScoreRow({
  player,
  frameNumber,
  match,
  localScores,
  bonusPointEnabled,
  onScoreChange,
}: MatchPlayerScoreRowProps) {
  const currentScore = getResolvedScore(player.event_player_id, frameNumber, localScores, match.frames);

  return (
    <ScoreStepperRow
      label={player.full_name}
      subtitle={player.pool ?? undefined}
      badge={player.zone != null ? <ZoneBadge zone={player.zone} distanceFt={player.putt_distance_ft} /> : undefined}
      score={currentScore}
      bonusPointEnabled={bonusPointEnabled}
      onChange={(puttsMade) => onScoreChange(player.event_player_id, frameNumber, puttsMade)}
    />
  );
}
