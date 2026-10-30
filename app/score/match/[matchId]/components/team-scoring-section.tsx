'use client';

import { cn } from '@/lib/utils/utils';
import { sortBySlot } from '@/lib/utils/team-utils';
import { PuttScoreRow } from '@/app/score/components/scoring-wizard/putt-score-row';
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
    <section
      aria-label={`Team ${teamNumber}`}
      className={cn(
        'bg-card rounded-2xl border border-t-4 p-3 flex flex-col gap-3',
        teamNumber === 1 ? 'border-t-team-1' : 'border-t-team-2'
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span
            aria-hidden="true"
            className={cn('size-2.5 shrink-0 rounded-full', teamNumber === 1 ? 'bg-team-1' : 'bg-team-2')}
          />
          <span className={cn('text-sm font-bold', teamNumber === 1 ? 'text-team-1-ink' : 'text-team-2-ink')}>
            Team {teamNumber}
          </span>
          <span className="truncate text-[13px] text-muted-foreground">
            #{team.seed} {team.pool_combo}
          </span>
        </div>
        <span className="shrink-0 text-[13px] font-semibold text-muted-foreground">
          This frame{' '}
          <span className="font-score text-xl font-bold text-foreground tabular-nums">{frameScore}</span>
        </span>
      </div>
      {sortBySlot(team.players).map((player) => (
        <MatchPlayerScoreRow
          key={player.event_player_id}
          player={player}
          teamNumber={teamNumber}
          frameNumber={frameNumber}
          match={match}
          localScores={localScores}
          bonusPointEnabled={bonusPointEnabled}
          onScoreChange={onScoreChange}
        />
      ))}
    </section>
  );
}

interface MatchPlayerScoreRowProps {
  player: PlayerInfo;
  teamNumber: 1 | 2;
  frameNumber: number;
  match: MatchInfo;
  localScores: ScoreState;
  bonusPointEnabled: boolean;
  onScoreChange: (eventPlayerId: string, frameNumber: number, puttsMade: number) => void;
}

function MatchPlayerScoreRow({
  player,
  teamNumber,
  frameNumber,
  match,
  localScores,
  bonusPointEnabled,
  onScoreChange,
}: MatchPlayerScoreRowProps) {
  const currentScore = getResolvedScore(player.event_player_id, frameNumber, localScores, match.frames);

  return (
    <PuttScoreRow
      label={player.full_name}
      subtitle={player.pool ? `Pool ${player.pool}` : undefined}
      badge={player.zone != null ? <ZoneBadge zone={player.zone} distanceFt={player.putt_distance_ft} size="sm" /> : undefined}
      score={currentScore}
      tone={teamNumber === 1 ? 'team-1' : 'team-2'}
      frameNumber={frameNumber}
      bonusPointEnabled={bonusPointEnabled}
      onChange={(puttsMade) => onScoreChange(player.event_player_id, frameNumber, puttsMade)}
    />
  );
}
