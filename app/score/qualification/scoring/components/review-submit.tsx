'use client';

import { Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils/utils';
import { ScoringBoard, ScoringFooter } from '@/app/score/components/scoring-wizard/scoring-board';
import { MAX_PUTTS } from '@/app/score/components/scoring-wizard/scoring-utils';

interface QualificationFrameInfo {
  id: string;
  frame_number: number;
  putts_made: number;
  points_earned: number;
}

interface QualificationPlayerInfo {
  event_player_id: string;
  full_name: string;
  player_number: number | null;
  total_points: number;
  frames: QualificationFrameInfo[];
}

interface ReviewSubmitProps {
  players: QualificationPlayerInfo[];
  frameCount: number;
  isSubmitting: boolean;
  onSubmit: () => void;
  onEditFrame: (frameNumber: number) => void;
  onBack: () => void;
}

export function QualificationReviewSubmit({
  players,
  frameCount,
  isSubmitting,
  onSubmit,
  onEditFrame,
  onBack,
}: ReviewSubmitProps) {
  const frameNumbers = Array.from({ length: frameCount }, (_, index) => index + 1);

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <ScoringBoard backLabel="Frames" onBack={onBack} backDisabled={isSubmitting} className="pb-5 gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-xs font-bold tracking-[0.08em] text-muted-foreground uppercase">
            Qualification · all {frameCount} frames
          </span>
          <h1 className="font-score text-[40px] leading-[0.95] font-bold">Review scores</h1>
        </div>
      </ScoringBoard>

      <div className="flex-1 w-full max-w-lg mx-auto p-4 flex flex-col gap-3">
        <div className="bg-card rounded-2xl border px-1 py-1.5">
          <div className="overflow-x-auto">
            <table className="w-full tabular-nums">
              <caption className="px-2.5 pt-2 pb-1.5 text-left text-[13px] font-bold text-muted-foreground">
                Points by frame · tap a frame to edit it
              </caption>
              <thead>
                <tr className="text-xs text-muted-foreground">
                  <th scope="col" className="px-2.5 py-1.5 text-left font-semibold">Player</th>
                  {frameNumbers.map((frameNumber) => (
                    <th key={frameNumber} scope="col" className="min-w-[28px] p-0 font-semibold">
                      <button
                        type="button"
                        onClick={() => onEditFrame(frameNumber)}
                        className="inline-flex min-h-8 min-w-[28px] items-center justify-center rounded-md px-1 hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
                        title={`Edit frame ${frameNumber}`}
                        disabled={isSubmitting}
                      >
                        {frameNumber}
                      </button>
                    </th>
                  ))}
                  <th scope="col" className="py-1.5 pr-2.5 text-right font-semibold">Total</th>
                </tr>
              </thead>
              <tbody className="text-center text-[15px]">
                {players.map((player) => (
                  <tr key={player.event_player_id} className="border-t border-muted">
                    <th scope="row" className="max-w-[140px] truncate px-2.5 py-3 text-left text-sm font-semibold">
                      {player.full_name}
                    </th>
                    {frameNumbers.map((frameNumber) => {
                      const frame = player.frames.find((item) => item.frame_number === frameNumber);

                      return (
                        <td
                          key={frameNumber}
                          className={cn(frame?.putts_made === MAX_PUTTS && 'font-bold text-success')}
                        >
                          {frame?.points_earned ?? '–'}
                        </td>
                      );
                    })}
                    <td className="pr-2.5 text-right font-score text-[22px] font-bold">{player.total_points}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="px-2.5 py-2 text-xs text-muted-foreground">
            <span className="font-bold text-success">Green</span> = 3 of 3 made.
          </p>
        </div>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Qualifying totals set Pool A and Pool B when the organizer starts bracket play.
        </p>
      </div>

      <ScoringFooter>
        <div className="flex gap-2">
          <Button
            variant="outline"
            className="flex-1 h-[54px] rounded-[14px] text-base"
            onClick={onBack}
            disabled={isSubmitting}
          >
            Edit
          </Button>
          <Button className="flex-[2] h-[54px] rounded-[14px] text-base" onClick={onSubmit} disabled={isSubmitting}>
            <Check className="size-[18px]" strokeWidth={2.5} />
            {isSubmitting ? 'Submitting...' : 'Submit scores'}
          </Button>
        </div>
      </ScoringFooter>
    </div>
  );
}
