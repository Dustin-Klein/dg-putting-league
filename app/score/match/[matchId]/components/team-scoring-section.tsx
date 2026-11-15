'use client';

import type { CSSProperties } from 'react';
import { cn } from '@/lib/utils/utils';
import { sortBySlot } from '@/lib/utils/team-utils';
import { PuttButtonGroup } from '@/app/score/components/scoring-wizard/putt-score-row';
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

/**
 * Large layout: sizes scale with the card's height per player (100cqh / --rows), so
 * a taller phone gets a proportionally larger card instead of stretched buttons.
 */
const ROOMY = {
  singles: {
    label: 'text-[length:clamp(13px,calc(100cqh*0.05),16px)]',
    total: 'text-[length:clamp(44px,calc(100cqh*0.28),96px)]',
    name: 'text-[length:clamp(17px,calc(100cqh*0.07),24px)]',
    row: 'max-h-[156px]',
    buttons: 'max-h-[116px]',
  },
  team: {
    label: 'text-[13px]',
    total: 'text-[length:clamp(40px,calc(100cqh/var(--rows)*0.24),76px)]',
    name: 'text-[length:clamp(16px,calc(100cqh/var(--rows)*0.06),20px)]',
    row: 'max-h-[136px]',
    buttons: 'max-h-[104px]',
  },
};

interface TeamScoringSectionProps {
  team: TeamInfo;
  teamNumber: 1 | 2;
  total: number;
  frameNumber: number;
  match: MatchInfo;
  localScores: ScoreState;
  bonusPointEnabled: boolean;
  /** The screen has room for the large layout (see useRoomyLayout). */
  roomy: boolean;
  onScoreChange: (eventPlayerId: string, frameNumber: number, puttsMade: number) => void;
  onScoreClear: (eventPlayerId: string, frameNumber: number) => void;
}

/** One team's card: its total and this frame's points, then a row per player. */
export function TeamScoringSection({
  team,
  teamNumber,
  total,
  frameNumber,
  match,
  localScores,
  bonusPointEnabled,
  roomy,
  onScoreChange,
  onScoreClear,
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

  // pool_combo defaults to the players' names, which the rows already show.
  const showCombo = team.pool_combo !== team.players.map((player) => player.full_name).join(' & ');
  const sizes = team.players.length === 1 ? ROOMY.singles : ROOMY.team;
  const ink = teamNumber === 1 ? 'text-team-1-ink' : 'text-team-2-ink';

  return (
    <section
      aria-label={`Team ${teamNumber}`}
      style={{ '--rows': team.players.length } as CSSProperties}
      className={cn(
        'flex flex-col bg-card border border-l-4 [flex:var(--rows)_1_0]',
        teamNumber === 1 ? 'border-l-team-1' : 'border-l-team-2',
        // Size containment only when the layout is known to fit. A compact card never
        // shrinks below 40px rows, so on very short screens the player area scrolls instead.
        roomy
          ? 'min-h-0 rounded-[18px] px-3.5 [container-type:size]'
          : 'min-h-[calc(var(--rows)*40px+30px)] rounded-xl pt-0.5 pr-2 pb-1 pl-2.5'
      )}
    >
      {roomy ? (
        <div className="flex shrink-0 items-end justify-between gap-2 pt-[calc(100cqh/var(--rows)*0.04)] pb-[calc(100cqh/var(--rows)*0.02)]">
          <div className="flex min-w-0 flex-col gap-0.5">
            <div className="flex min-w-0 items-baseline gap-1.5">
              <span className={cn('font-bold tracking-[0.06em] uppercase', ink, sizes.label)}>Team {teamNumber}</span>
              <span className="truncate text-[13px] font-semibold text-muted-foreground">
                #{team.seed}
                {showCombo && ` · ${team.pool_combo}`}
              </span>
            </div>
            <span className="text-xs font-semibold whitespace-nowrap text-muted-foreground">
              +{frameScore} this frame
            </span>
          </div>
          <span className={cn('shrink-0 font-score font-bold tabular-nums', sizes.total, 'leading-[0.85]')}>
            <span className="sr-only">Total: </span>
            {total}
          </span>
        </div>
      ) : (
        <div className="flex h-[22px] shrink-0 items-center justify-between gap-2">
          <div className="flex min-w-0 items-baseline gap-1.5">
            <span className={cn('text-xs font-bold tracking-[0.06em] uppercase', ink)}>Team {teamNumber}</span>
            <span className="truncate text-xs font-semibold text-muted-foreground">
              #{team.seed}
              {showCombo && ` · ${team.pool_combo}`}
            </span>
          </div>
          <div className="flex shrink-0 items-baseline gap-2">
            <span className="text-xs font-semibold text-muted-foreground">
              +{frameScore}
              <span className="sr-only"> this frame</span>
            </span>
            <span className="font-score text-[22px] leading-none font-bold tabular-nums">
              <span className="sr-only">Total: </span>
              {total}
            </span>
          </div>
        </div>
      )}
      <div className={cn('flex min-h-0 flex-1 flex-col justify-evenly', roomy && 'gap-2 pb-2')}>
        {sortBySlot(team.players).map((player) => (
          <MatchPlayerScoreRow
            key={player.event_player_id}
            player={player}
            teamNumber={teamNumber}
            frameNumber={frameNumber}
            match={match}
            localScores={localScores}
            bonusPointEnabled={bonusPointEnabled}
            roomy={roomy}
            sizes={sizes}
            onScoreChange={onScoreChange}
            onScoreClear={onScoreClear}
          />
        ))}
      </div>
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
  roomy: boolean;
  sizes: (typeof ROOMY)[keyof typeof ROOMY];
  onScoreChange: (eventPlayerId: string, frameNumber: number, puttsMade: number) => void;
  onScoreClear: (eventPlayerId: string, frameNumber: number) => void;
}

function MatchPlayerScoreRow({
  player,
  teamNumber,
  frameNumber,
  match,
  localScores,
  bonusPointEnabled,
  roomy,
  sizes,
  onScoreChange,
  onScoreClear,
}: MatchPlayerScoreRowProps) {
  const currentScore = getResolvedScore(player.event_player_id, frameNumber, localScores, match.frames);
  const badge =
    player.zone != null ? (
      <ZoneBadge zone={player.zone} distanceFt={player.putt_distance_ft} size={roomy ? 'md' : 'sm'} />
    ) : null;

  const buttons = (
    <PuttButtonGroup
      label={`Putts made by ${player.full_name}, frame ${frameNumber}`}
      score={currentScore}
      bonusPointEnabled={bonusPointEnabled}
      tone={teamNumber === 1 ? 'team-1' : 'team-2'}
      onChange={(puttsMade) => onScoreChange(player.event_player_id, frameNumber, puttsMade)}
      onClear={
        localScores.has(getScoreKey(player.event_player_id, frameNumber))
          ? () => onScoreClear(player.event_player_id, frameNumber)
          : undefined
      }
      className={
        roomy
          ? cn('min-h-11 flex-1 grid-rows-[minmax(0,1fr)] gap-2', sizes.buttons)
          : 'shrink-0 self-stretch grid-cols-[repeat(4,50px)] grid-rows-[minmax(0,1fr)] gap-1 py-px'
      }
      buttonClassName={
        roomy
          ? // A size container so a short button can shrink its number to keep "+1 BONUS" inside.
            'h-full min-h-0 rounded-[14px] text-[length:clamp(30px,calc(100cqh/var(--rows)*0.13),40px)] [container-type:size]'
          : 'h-full min-h-0 rounded-[10px] [container-type:size]'
      }
      contentClassName={
        roomy ? '[@container(max-height:58px)]:text-[24px]' : 'text-[18px] [@container(min-height:44px)]:text-[24px]'
      }
      bonusClassName={roomy ? 'mt-1 leading-none' : 'mt-px text-[9px] leading-none tracking-normal'}
    />
  );

  if (roomy) {
    return (
      <div className={cn('flex min-h-0 flex-1 flex-col gap-1.5', sizes.row)}>
        <div className="flex min-w-0 items-center gap-2">
          <span className={cn('truncate font-semibold', sizes.name)}>{player.full_name}</span>
          {badge}
        </div>
        {buttons}
      </div>
    );
  }

  return (
    <div className="flex min-h-10 max-h-16 flex-1 basis-0 items-center gap-2 overflow-hidden border-t first:border-t-0">
      <div className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
        <span className="max-w-full truncate text-[15px] font-semibold">{player.full_name}</span>
        {badge}
      </div>
      {buttons}
    </div>
  );
}
