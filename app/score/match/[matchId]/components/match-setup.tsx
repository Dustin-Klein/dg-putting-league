'use client';

import { Button } from '@/components/ui/button';
import { ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils/utils';
import { MatchStatus, getStatusLabel } from '@/lib/types/bracket';
import { sortBySlot } from '@/lib/utils/team-utils';
import { ZoneBadge } from '@/components/zone-badge';
import { PoolBadge } from '@/components/pool-badge';
import { ScoringBoard, ScoringFooter } from '@/app/score/components/scoring-wizard/scoring-board';
import { MatchMeta } from './frame-wizard-header';
import type { MatchInfo, PlayerInfo, TeamInfo } from './wizard-types';

interface MatchSetupProps {
  match: MatchInfo;
  onBeginScoring: () => void;
  onBack: () => void;
}

export function MatchSetup({ match, onBeginScoring, onBack }: MatchSetupProps) {
  const isCompleted = match.status === MatchStatus.Completed;
  const isRunning = match.status === MatchStatus.Running;
  const scoredFrames = match.frames.length;

  return (
    <div className="min-h-full flex flex-col bg-background">
      <ScoringBoard backLabel="Matches" onBack={onBack} meta={<MatchMeta match={match} />} className="pb-[18px] gap-3">
        <div className="flex flex-col items-center gap-1 py-1">
          <span className="text-xs font-bold tracking-[0.08em] text-muted-foreground uppercase">
            {getStatusLabel(match.status)}
            {isRunning && scoredFrames > 0 && ` · ${scoredFrames} ${scoredFrames === 1 ? 'frame' : 'frames'} scored`}
          </span>
          <div className="flex items-baseline gap-4 font-score font-bold tabular-nums">
            <span className="text-[60px] leading-[0.9]">
              <span className="sr-only">Team 1: </span>
              {match.team_one_score}
            </span>
            <span className="text-[26px] text-muted-foreground" aria-hidden="true">–</span>
            <span className="text-[60px] leading-[0.9]">
              <span className="sr-only">Team 2: </span>
              {match.team_two_score}
            </span>
          </div>
        </div>
      </ScoringBoard>

      <div className="flex-1 w-full max-w-lg mx-auto p-4 flex flex-col gap-3">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-lg font-bold">Check the teams</h1>
          <p className="text-sm text-muted-foreground">Make sure everyone on the lane is in this match.</p>
        </div>

        <TeamCard team={match.team_one} teamNumber={1} />
        <TeamCard team={match.team_two} teamNumber={2} />
      </div>

      <ScoringFooter>
        <Button
          className="w-full h-14 rounded-[14px] text-[17px]"
          onClick={onBeginScoring}
          disabled={isCompleted}
        >
          {isCompleted ? 'Match Completed' : isRunning && scoredFrames > 0 ? 'Resume scoring' : 'Begin Scoring'}
          {!isCompleted && <ArrowRight className="size-[18px]" />}
        </Button>
        {!isCompleted && (
          <p className="text-[13px] text-muted-foreground text-center">
            You&apos;ll score one frame at a time.
          </p>
        )}
      </ScoringFooter>
    </div>
  );
}

interface TeamCardProps {
  team: TeamInfo;
  teamNumber: 1 | 2;
}

function TeamCard({ team, teamNumber }: TeamCardProps) {
  return (
    <section
      aria-label={`Team ${teamNumber}`}
      className={cn(
        'bg-card rounded-2xl border border-t-4 px-3.5 pt-2.5 pb-1 flex flex-col',
        teamNumber === 1 ? 'border-t-team-1' : 'border-t-team-2'
      )}
    >
      <div className="flex items-center justify-between pt-1 pb-1.5">
        <span
          className={cn(
            'inline-flex items-center gap-2 text-sm font-bold',
            teamNumber === 1 ? 'text-team-1-ink' : 'text-team-2-ink'
          )}
        >
          <span
            aria-hidden="true"
            className={cn('size-2.5 rounded-full', teamNumber === 1 ? 'bg-team-1' : 'bg-team-2')}
          />
          Team {teamNumber}
        </span>
        <span className="truncate pl-2 text-[13px] text-muted-foreground">
          Seed {team.seed}
          {team.pool_combo !== team.players.map((p) => p.full_name).join(' & ') && ` · ${team.pool_combo}`}
        </span>
      </div>
      {sortBySlot(team.players).map((player) => (
        <PlayerDisplay key={player.event_player_id} player={player} />
      ))}
    </section>
  );
}

function PlayerDisplay({ player }: { player: PlayerInfo }) {
  return (
    <div className="flex items-center gap-2 border-t border-muted py-2.5">
      <div className="min-w-0 flex-1">
        <div className="text-base font-semibold">{player.full_name}</div>
        {player.nickname && (
          <div className="text-xs text-muted-foreground">&quot;{player.nickname}&quot;</div>
        )}
      </div>
      <ZoneBadge zone={player.zone} distanceFt={player.putt_distance_ft} size="sm" />
      <PoolBadge pool={player.pool} />
    </div>
  );
}
