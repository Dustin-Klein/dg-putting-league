'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Check, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils/utils';
import { ScoringBoard } from '@/app/score/components/scoring-wizard/scoring-board';
import { PuttScoreRow } from '@/app/score/components/scoring-wizard/putt-score-row';
import { MAX_PUTTS } from '@/app/score/components/scoring-wizard/scoring-utils';
import { useToast } from '@/components/ui/use-toast';
import { ZoneBadge } from '@/components/zone-badge';

interface PlayerInfo {
  event_player_id: string;
  player_id: string;
  full_name: string;
  nickname: string | null;
  player_number: number | null;
  /** Handicap zone; null when the event has no handicaps. */
  zone?: number | null;
  putt_distance_ft?: number;
  frames_completed: number;
  total_frames_required: number;
  total_points: number;
  is_complete: boolean;
}

interface FrameInfo {
  id: string;
  frame_number: number;
  putts_made: number;
  points_earned: number;
}

interface EventInfo {
  id: string;
  event_date: string;
  location: string | null;
  bonus_point_enabled: boolean;
}

export default function QualificationScoringPage() {
  const router = useRouter();
  const params = useParams();
  const eventPlayerId = params.eventPlayerId as string;
  const { toast } = useToast();

  const [accessCode, setAccessCode] = useState<string | null>(null);
  const [event, setEvent] = useState<EventInfo | null>(null);
  const [player, setPlayer] = useState<PlayerInfo | null>(null);
  const [frames, setFrames] = useState<FrameInfo[]>([]);
  const [nextFrameNumber, setNextFrameNumber] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedPutts, setSelectedPutts] = useState<number | null>(null);

  const fetchPlayerData = useCallback(async (code: string) => {
    try {
      setIsLoading(true);
      const response = await fetch(
        `/api/score/qualification/${eventPlayerId}?access_code=${encodeURIComponent(code)}`
      );

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to load player data');
      }

      const data = await response.json();
      setEvent(data.event);
      setPlayer(data.player);
      setFrames(data.frames || []);
      setNextFrameNumber(data.nextFrameNumber);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load player data');
    } finally {
      setIsLoading(false);
    }
  }, [eventPlayerId]);

  useEffect(() => {
    const code = sessionStorage.getItem('scoring_access_code');
    if (!code) {
      router.push('/score');
      return;
    }
    setAccessCode(code);
    fetchPlayerData(code);
  }, [router, fetchPlayerData]);

  const handleRecordScore = async () => {
    if (selectedPutts === null || !accessCode) return;

    try {
      setIsSaving(true);
      const response = await fetch(`/api/score/qualification/${eventPlayerId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          access_code: accessCode,
          frame_number: nextFrameNumber,
          putts_made: selectedPutts,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to record score');
      }

      const data = await response.json();

      // Update local state
      setPlayer(data.player);
      setFrames((prev) => [...prev, data.frame].sort((a, b) => a.frame_number - b.frame_number));
      setNextFrameNumber((prev) => prev + 1);
      setSelectedPutts(null);

    } catch (err) {
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to record score',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleBack = () => {
    router.push('/score/qualification');
  };

  const handleExit = () => {
    sessionStorage.removeItem('scoring_access_code');
    router.push('/score');
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6 text-center">
            <p className="text-destructive mb-4">{error}</p>
            <div className="space-x-2">
              <Button variant="outline" onClick={handleBack}>
                Back to Players
              </Button>
              <Button onClick={handleExit}>Exit</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!player) {
    return null;
  }

  const bonusPointEnabled = event?.bonus_point_enabled ?? false;

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <ScoringBoard
        backLabel="Players"
        onBack={handleBack}
        className="max-w-2xl pb-5 gap-3"
        meta={
          <Button
            variant="outline"
            size="icon"
            className="size-10"
            aria-label="Refresh"
            onClick={() => accessCode && fetchPlayerData(accessCode)}
          >
            <RefreshCw className="size-4" />
          </Button>
        }
      >
        <div className="flex items-end justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1.5">
            <h1 className="font-score text-[38px] leading-[0.95] font-bold">{player.full_name}</h1>
            <div className="flex items-center gap-2">
              <ZoneBadge zone={player.zone} distanceFt={player.putt_distance_ft} className="w-fit" />
              <span className="text-[13px] text-muted-foreground">
                {player.player_number ? `#${player.player_number}` : 'Qualification Round'}
              </span>
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-end">
            <span className="font-score text-[56px] leading-[0.9] font-bold tabular-nums">{player.total_points}</span>
            <span className="text-xs text-muted-foreground">points</span>
          </div>
        </div>
      </ScoringBoard>

      <div className="flex-1 w-full max-w-2xl mx-auto p-4 flex flex-col gap-4">
        {player.is_complete ? (
          <div role="status" className="flex items-center gap-2.5 rounded-[14px] bg-success/15 px-3.5 py-3 text-[15px] font-bold text-success">
            <Check className="size-5 shrink-0" strokeWidth={2.5} aria-hidden="true" />
            Qualification Complete! · {player.frames_completed} of {player.total_frames_required} frames
          </div>
        ) : (
          <section aria-label={`Frame ${nextFrameNumber}`} className="bg-card rounded-2xl border p-3.5 flex flex-col gap-3">
            <div className="flex items-baseline justify-between">
              <h2 className="text-base font-bold">Frame {nextFrameNumber}</h2>
              <span className="text-[13px] text-muted-foreground">
                {player.frames_completed} / {player.total_frames_required} frames
              </span>
            </div>
            <PuttScoreRow
              label="How many putts were made?"
              groupLabel={`Putts made by ${player.full_name}`}
              aside={
                <span className="text-[13px] font-semibold text-muted-foreground">
                  {selectedPutts === null
                    ? ''
                    : selectedPutts === 3
                      ? bonusPointEnabled
                        ? '4 points (3 putts + bonus)'
                        : '3 points'
                      : `${selectedPutts} point${selectedPutts === 1 ? '' : 's'}`}
                </span>
              }
              score={selectedPutts}
              bonusPointEnabled={bonusPointEnabled}
              frameNumber={nextFrameNumber}
              disabled={isSaving}
              onChange={setSelectedPutts}
            />
            <Button
              className="h-14 w-full rounded-[14px] text-[17px]"
              onClick={handleRecordScore}
              disabled={selectedPutts === null || isSaving}
            >
              {isSaving ? 'Recording...' : 'Record Score'}
            </Button>
          </section>
        )}

        {frames.length > 0 && (
          <section aria-labelledby="frame-history" className="bg-card rounded-2xl border flex flex-col">
            <h2 id="frame-history" className="px-4 pt-3.5 pb-2 text-base font-bold">Frame History</h2>
            {frames.map((frame) => (
              <div key={frame.id} className="flex items-center gap-3.5 border-t border-muted px-4 py-3">
                <span className="w-16 shrink-0 text-sm font-semibold text-muted-foreground">
                  Frame {frame.frame_number}
                </span>
                <span
                  className="flex flex-1 gap-1.5"
                  role="img"
                  aria-label={`${frame.putts_made} of ${MAX_PUTTS} made`}
                >
                  {Array.from({ length: MAX_PUTTS }, (_, i) => (
                    <span
                      key={i}
                      className={cn(
                        'size-[22px] rounded-full border-2',
                        i < frame.putts_made ? 'border-foreground bg-foreground' : 'border-input'
                      )}
                    />
                  ))}
                </span>
                <span
                  className={cn(
                    'font-score text-2xl font-bold tabular-nums',
                    frame.putts_made === MAX_PUTTS && 'text-success'
                  )}
                >
                  {frame.points_earned} pt{frame.points_earned !== 1 ? 's' : ''}
                </span>
              </div>
            ))}
          </section>
        )}

        {frames.length > 0 && (
          <p className="text-center text-[13px] text-muted-foreground">
            Filled circle = putt made. 3 of 3 earns the bonus point.
          </p>
        )}

        {player.is_complete && (
          <Button variant="outline" className="w-full" onClick={handleBack}>
            Back to Players
          </Button>
        )}
      </div>
    </div>
  );
}
