'use client';

import { Button } from '@/components/ui/button';
import { Check, Loader2, Trophy, Users } from 'lucide-react';
import { cn } from '@/lib/utils/utils';
import { sortBySlot } from '@/lib/utils/team-utils';
import { ScoringBoard, LaneChip, ScoringFooter } from '@/app/score/components/scoring-wizard/scoring-board';
import type { MatchInfo, PlayerInfo, TeamInfo } from './wizard-types';
import { getFrameNumbers, MAX_PUTTS } from './wizard-types';

interface ReviewSubmitProps {
  match: MatchInfo;
  standardFrames: number;
  isCompleting: boolean;
  error: string | null;
  onSubmit: () => void;
  onEditFrame: (frameNumber: number) => void;
  onBack: () => void;
}

export function ReviewSubmit({
  match,
  standardFrames,
  isCompleting,
  error,
  onSubmit,
  onEditFrame,
  onBack,
}: ReviewSubmitProps) {
  const frameNumbers = getFrameNumbers(match, standardFrames);
  const isTied = match.team_one_score === match.team_two_score;

  const team1Wins = match.team_one_score > match.team_two_score;
  const team2Wins = match.team_two_score > match.team_one_score;
  const overtimeFrames = frameNumbers.filter((num) => num > standardFrames).length;

  return (
    <div className="min-h-full flex flex-col bg-background">
      <ScoringBoard
        backLabel="Frames"
        onBack={onBack}
        meta={match.lane_label ? <LaneChip label={match.lane_label} /> : undefined}
        className="pb-5 gap-3"
      >
        <div className="flex flex-col items-center gap-1">
          <span className="text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">
            Review · {standardFrames} frames
            {overtimeFrames > 0 && ` + ${overtimeFrames} OT`}
          </span>
          <div className="flex items-baseline gap-3.5 font-score font-bold tabular-nums">
            <span className={cn('text-[64px] leading-[0.9]', team2Wins && 'text-muted-foreground')}>
              <span className="sr-only">Team 1: </span>
              {match.team_one_score}
            </span>
            <span className="text-[28px] text-muted-foreground" aria-hidden="true">–</span>
            <span className={cn('text-[64px] leading-[0.9]', team1Wins && 'text-muted-foreground')}>
              <span className="sr-only">Team 2: </span>
              {match.team_two_score}
            </span>
          </div>
          {isTied ? (
            <span className="mt-1 text-[15px] font-bold text-warning">Scores are tied</span>
          ) : (
            <span className="mt-1 inline-flex items-center gap-2 text-[15px] font-bold">
              <Trophy className="size-4 text-gold" aria-hidden="true" />
              <span
                aria-hidden="true"
                className={cn('size-2.5 rounded-full', team1Wins ? 'bg-team-1' : 'bg-team-2')}
              />
              {team1Wins ? 'Team 1' : 'Team 2'} wins
            </span>
          )}
        </div>
      </ScoringBoard>

      <div className="flex-1 w-full max-w-lg mx-auto p-4 flex flex-col gap-3">
        {isTied && (
          <div className="rounded-xl bg-warning/15 p-3 text-center">
            <p className="text-sm font-semibold text-warning">Scores are tied</p>
            <p className="text-xs text-warning">
              Go back and complete overtime frames until there&apos;s a winner
            </p>
          </div>
        )}

        <div className="bg-card rounded-2xl border px-1 py-1.5">
          <div className="overflow-x-auto">
            <table className="w-full tabular-nums">
              <caption className="px-2.5 pt-2 pb-1.5 text-left text-[13px] font-bold text-muted-foreground">
                Points by frame · tap a frame to edit it
              </caption>
              <thead>
                <tr className="text-xs text-muted-foreground">
                  <th scope="col" className="px-2.5 py-1.5 text-left font-semibold">Player</th>
                  {frameNumbers.map((num) => (
                    <th key={num} scope="col" className="min-w-[30px] p-0 font-semibold">
                      <button
                        type="button"
                        onClick={() => onEditFrame(num)}
                        className={cn(
                          'inline-flex min-h-8 min-w-[30px] items-center justify-center rounded-md px-1 hover:bg-muted hover:text-foreground',
                          num > standardFrames && 'text-warning'
                        )}
                        aria-label={`Edit frame ${num > standardFrames ? `OT${num - standardFrames}` : num}`}
                        title={`Edit frame ${num}`}
                      >
                        {num > standardFrames ? `OT${num - standardFrames}` : num}
                      </button>
                    </th>
                  ))}
                  <th scope="col" className="py-1.5 pr-2.5 text-right font-semibold">Total</th>
                </tr>
              </thead>
              <tbody className="text-center text-[15px]">
                <TeamRows team={match.team_one} teamNumber={1} total={match.team_one_score} match={match} frameNumbers={frameNumbers} />
                <TeamRows team={match.team_two} teamNumber={2} total={match.team_two_score} match={match} frameNumbers={frameNumbers} />
              </tbody>
            </table>
          </div>
          <p className="px-2.5 pt-2.5 pb-2 text-xs text-muted-foreground">
            <span className="font-bold text-success">Green</span> = 3 of 3 made.
          </p>
        </div>

        <div className="bg-card rounded-xl border p-3 flex items-start gap-2.5">
          <Users className="mt-px size-5 shrink-0" aria-hidden="true" />
          <p className="text-sm leading-snug">
            Show this screen to both teams before you submit. After that, only an event admin can change the result.
          </p>
        </div>

        {error && (
          <div role="alert" className="rounded-xl bg-destructive/15 p-3 text-sm text-center text-destructive">
            {error}
          </div>
        )}
      </div>

      <ScoringFooter>
        {isTied && (
          <p className="text-[13px] text-muted-foreground text-center">
            Cannot submit while scores are tied
          </p>
        )}
        <div className="flex gap-2">
          <Button
            variant="outline"
            className="flex-1 h-[54px] rounded-[14px] text-base"
            onClick={onBack}
          >
            Edit
          </Button>
          <Button
            className="flex-[2] h-[54px] rounded-[14px] text-base"
            onClick={onSubmit}
            disabled={isCompleting || isTied}
          >
            {isCompleting ? (
              <>
                <Loader2 className="size-5 animate-spin" />
                Submitting...
              </>
            ) : (
              <>
                <Check className="size-[18px]" strokeWidth={2.5} />
                Submit Match
              </>
            )}
          </Button>
        </div>
      </ScoringFooter>
    </div>
  );
}

interface TeamRowsProps {
  team: TeamInfo;
  teamNumber: 1 | 2;
  total: number;
  match: MatchInfo;
  frameNumbers: number[];
}

function TeamRows({ team, teamNumber, total, match, frameNumbers }: TeamRowsProps) {
  const playerIds = new Set(team.players.map((player) => player.event_player_id));
  return (
    <>
      {sortBySlot(team.players).map((player, index) => (
        <PlayerScoreRow
          key={player.event_player_id}
          player={player}
          teamNumber={teamNumber}
          match={match}
          frameNumbers={frameNumbers}
          first={index === 0}
        />
      ))}
      <tr className={cn('font-bold', teamNumber === 1 ? 'bg-team-1/15 text-team-1-ink' : 'bg-team-2/15 text-team-2-ink')}>
        <th scope="row" className="px-2.5 py-2 text-left text-[13px]">
          Team {teamNumber} <span className="font-normal opacity-80">{team.pool_combo}</span>
        </th>
        {frameNumbers.map((frameNum) => {
          const frame = match.frames.find((f) => f.frame_number === frameNum);
          const results = frame?.results.filter((r) => playerIds.has(r.event_player_id)) ?? [];
          return (
            <td key={frameNum}>
              {results.length > 0 ? results.reduce((sum, r) => sum + r.points_earned, 0) : '–'}
            </td>
          );
        })}
        <td className="pr-2.5 text-right font-score text-[22px]">{total}</td>
      </tr>
    </>
  );
}

interface PlayerScoreRowProps {
  player: PlayerInfo;
  teamNumber: 1 | 2;
  match: MatchInfo;
  frameNumbers: number[];
  first: boolean;
}

function PlayerScoreRow({ player, teamNumber, match, frameNumbers, first }: PlayerScoreRowProps) {
  // Calculate total points for player
  let totalPoints = 0;
  for (const frame of match.frames) {
    const result = frame.results.find(r => r.event_player_id === player.event_player_id);
    if (result) {
      totalPoints += result.points_earned;
    }
  }

  return (
    <tr className={cn(first && 'border-t border-muted')}>
      <th scope="row" className="max-w-[140px] truncate px-2.5 py-2.5 text-left text-sm font-semibold">
        <span
          aria-hidden="true"
          className={cn('mr-1.5 inline-block size-2 rounded-full', teamNumber === 1 ? 'bg-team-1' : 'bg-team-2')}
        />
        {player.full_name}
      </th>
      {frameNumbers.map((frameNum) => {
        const frame = match.frames.find(f => f.frame_number === frameNum);
        const result = frame?.results.find(r => r.event_player_id === player.event_player_id);

        return (
          <td
            key={frameNum}
            className={cn(result?.putts_made === MAX_PUTTS && 'font-bold text-success')}
          >
            {result?.points_earned ?? '–'}
          </td>
        );
      })}
      <td className="pr-2.5 text-right font-bold">{totalPoints}</td>
    </tr>
  );
}
