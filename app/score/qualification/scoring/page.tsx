'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils/utils';
import { ScoringBoard, ScoringFooter } from '@/app/score/components/scoring-wizard/scoring-board';
import { useToast } from '@/components/ui/use-toast';
import { formatDisplayDate } from '@/lib/utils/date-utils';
import { FrameNavigation } from '@/app/score/components/scoring-wizard/frame-navigation';
import { PuttScoreRow } from '@/app/score/components/scoring-wizard/putt-score-row';
import {
  calculatePoints,
  getResolvedScore,
  getScoreKey,
  getSequentialFrameNumbers,
  type ScoreState,
} from '@/app/score/components/scoring-wizard/scoring-utils';
import { useWizardActionState } from '@/app/score/components/scoring-wizard/use-wizard-action-state';
import { QualificationReviewSubmit } from './components/review-submit';
import { ZoneBadge } from '@/components/zone-badge';

interface FrameInfo {
  id: string;
  frame_number: number;
  putts_made: number;
  points_earned: number;
}

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
  frames: FrameInfo[];
}

interface EventInfo {
  id: string;
  event_date: string;
  location: string | null;
  bonus_point_enabled: boolean;
}

interface RoundInfo {
  id: string;
  frame_count: number;
}

type WizardStage = 'scoring' | 'review';

interface QualificationPersistedFrame {
  frame_number: number;
  results: Array<{
    event_player_id: string;
    putts_made: number;
    points_earned: number;
  }>;
}

function buildPersistedFrames(players: PlayerInfo[]): QualificationPersistedFrame[] {
  const frames = new Map<number, QualificationPersistedFrame>();

  for (const player of players) {
    for (const frame of player.frames) {
      const existingFrame = frames.get(frame.frame_number) ?? {
        frame_number: frame.frame_number,
        results: [],
      };

      existingFrame.results.push({
        event_player_id: player.event_player_id,
        putts_made: frame.putts_made,
        points_earned: frame.points_earned,
      });

      frames.set(frame.frame_number, existingFrame);
    }
  }

  return Array.from(frames.values()).sort((left, right) => left.frame_number - right.frame_number);
}

function getFirstIncompleteFrame(players: PlayerInfo[], frameNumbers: number[]): number {
  const persistedFrames = buildPersistedFrames(players);

  for (const frameNumber of frameNumbers) {
    const complete = players.every(
      (player) => getResolvedScore(player.event_player_id, frameNumber, new Map(), persistedFrames) !== null
    );

    if (!complete) {
      return frameNumber;
    }
  }

  return frameNumbers[frameNumbers.length - 1] ?? 1;
}

export function clearSentLocalScores(
  previousScores: ScoreState,
  sentScoresByKey: ReadonlyMap<string, number>
): ScoreState {
  const nextScores = new Map(previousScores);

  for (const [scoreKey, puttsMadeSent] of sentScoresByKey) {
    if (nextScores.get(scoreKey) === puttsMadeSent) {
      nextScores.delete(scoreKey);
    }
  }

  return nextScores;
}

export default function QualificationScoringPage() {
  const router = useRouter();
  const { toast } = useToast();
  const { isSaving, runAction } = useWizardActionState();
  const [accessCode, setAccessCode] = useState<string | null>(null);
  const [event, setEvent] = useState<EventInfo | null>(null);
  const [round, setRound] = useState<RoundInfo | null>(null);
  const [players, setPlayers] = useState<PlayerInfo[]>([]);
  const [localScores, setLocalScores] = useState<ScoreState>(new Map());
  const [currentFrame, setCurrentFrame] = useState(1);
  const [wizardStage, setWizardStage] = useState<WizardStage>('scoring');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const persistedFrames = useMemo(() => buildPersistedFrames(players), [players]);
  const frameNumbers = useMemo(
    () => (round ? getSequentialFrameNumbers([], round.frame_count) : []),
    [round]
  );

  const fetchPlayersData = useCallback(async (code: string, playerIds: string[], showLoading = true) => {
    try {
      if (showLoading) {
        setIsLoading(true);
      }

      const response = await fetch('/api/score/qualification/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          access_code: code,
          event_player_ids: playerIds,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to load players');
      }

      const data = await response.json();
      setEvent(data.event);
      setRound(data.round);
      setPlayers(data.players || []);
      setCurrentFrame(getFirstIncompleteFrame(data.players || [], getSequentialFrameNumbers([], data.round.frame_count)));
      setLocalScores(new Map());
      setWizardStage('scoring');
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load players');
    } finally {
      if (showLoading) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    const code = sessionStorage.getItem('scoring_access_code');
    const selectedPlayersJson = sessionStorage.getItem('qualification_selected_players');

    if (!code) {
      router.push('/score');
      return;
    }

    if (!selectedPlayersJson) {
      router.push('/score/qualification');
      return;
    }

    try {
      const selectedPlayers = JSON.parse(selectedPlayersJson) as string[];
      if (selectedPlayers.length === 0) {
        router.push('/score/qualification');
        return;
      }

      setAccessCode(code);
      void fetchPlayersData(code, selectedPlayers);
    } catch {
      router.push('/score/qualification');
    }
  }, [fetchPlayersData, router]);

  const getPlayerScore = useCallback(
    (player: PlayerInfo, frameNumber: number): number | null =>
      getResolvedScore(player.event_player_id, frameNumber, localScores, persistedFrames),
    [localScores, persistedFrames]
  );

  const frameComplete = players.every((player) => getPlayerScore(player, currentFrame) !== null);
  const allFramesComplete =
    frameNumbers.length > 0 &&
    frameNumbers.every((frameNumber) => players.every((player) => getPlayerScore(player, frameNumber) !== null));

  const saveFrameScores = useCallback(async (frameNumber: number): Promise<boolean> => {
    if (!accessCode) {
      return false;
    }

    const frameEntries = players
      .map((player) => ({
        player,
        puttsMade: localScores.get(getScoreKey(player.event_player_id, frameNumber)),
      }))
      .filter(
        (entry): entry is { player: PlayerInfo; puttsMade: number } => entry.puttsMade !== undefined
      );

    if (frameEntries.length === 0) {
      return true;
    }

    const sentScoresByKey = new Map(
      frameEntries.map(({ player, puttsMade }) => [getScoreKey(player.event_player_id, frameNumber), puttsMade])
    );

    try {
      // One request for the whole group: saved together or not at all.
      const response = await fetch('/api/score/qualification/frames', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          access_code: accessCode,
          frame_number: frameNumber,
          scores: frameEntries.map(({ player, puttsMade }) => ({
            event_player_id: player.event_player_id,
            putts_made: puttsMade,
          })),
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to save scores');
      }

      const { results: responses } = (await response.json()) as {
        results: Array<{ frame: FrameInfo; player: Omit<PlayerInfo, 'frames'> }>;
      };

      setPlayers((previousPlayers) =>
        previousPlayers.map((player) => {
          const update = responses.find((item) => item.player.event_player_id === player.event_player_id);

          if (!update) {
            return player;
          }

          const existingIndex = player.frames.findIndex(
            (frame) => frame.frame_number === update.frame.frame_number
          );
          const nextFrames =
            existingIndex >= 0
              ? player.frames.map((frame, index) => (index === existingIndex ? update.frame : frame))
              : [...player.frames, update.frame].sort((left, right) => left.frame_number - right.frame_number);

          return {
            ...player,
            ...update.player,
            frames: nextFrames,
          };
        })
      );

      setLocalScores((previousScores) => {
        return clearSentLocalScores(previousScores, sentScoresByKey);
      });

      return true;
    } catch (err) {
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to save scores',
      });

      return false;
    }
  }, [accessCode, localScores, players, toast]);

  const handleScoreChange = (eventPlayerId: string, frameNumber: number, puttsMade: number) => {
    setLocalScores((previousScores) => {
      const nextScores = new Map(previousScores);
      nextScores.set(getScoreKey(eventPlayerId, frameNumber), puttsMade);
      return nextScores;
    });
  };

  const handleBack = () => {
    sessionStorage.removeItem('qualification_selected_players');
    router.push('/score/qualification');
  };

  const handleSubmit = async () => {
    const saved = await saveFrameScores(currentFrame);
    if (!saved) {
      return;
    }

    sessionStorage.removeItem('qualification_selected_players');
    router.push('/score/qualification');
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (error || !round) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6 text-center">
            <p className="text-destructive mb-4">{error || 'Qualification round not found'}</p>
            <Button onClick={handleBack}>Back to Player Selection</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (wizardStage === 'review') {
    return (
      <QualificationReviewSubmit
        players={players}
        frameCount={round.frame_count}
        isSubmitting={isSaving}
        onSubmit={() => void runAction(handleSubmit)}
        onEditFrame={(frameNumber) => {
          if (isSaving) {
            return;
          }

          setCurrentFrame(frameNumber);
          setWizardStage('scoring');
        }}
        onBack={() => {
          if (isSaving) {
            return;
          }

          setWizardStage('scoring');
        }}
      />
    );
  }

  const scoredFrames = new Set(
    frameNumbers.filter((frameNumber) => players.every((player) => getPlayerScore(player, frameNumber) !== null))
  );
  const bonusPointEnabled = event?.bonus_point_enabled ?? false;

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <ScoringBoard
        backLabel="Players"
        onBack={handleBack}
        meta={<span className="text-muted-foreground">Qualification</span>}
      >
        <div className="flex items-end justify-between">
          <div className="flex flex-col">
            <span className="text-[11px] font-bold tracking-[0.08em] text-muted-foreground">FRAME</span>
            <span className="font-score text-[40px] leading-[0.95] font-bold tabular-nums">
              {currentFrame} / {round.frame_count}
            </span>
          </div>
          <div className="flex flex-col items-end text-[13px] text-muted-foreground">
            <span>
              Scoring {players.length} Player{players.length !== 1 ? 's' : ''}
            </span>
            <span>
              {[event?.location, event?.event_date && formatDisplayDate(event.event_date)]
                .filter(Boolean)
                .join(' · ')}
            </span>
          </div>
        </div>
        <FrameNavigation
          frameNumbers={frameNumbers}
          currentFrame={currentFrame}
          standardFrames={round.frame_count}
          scoredFrames={scoredFrames}
          disabled={isSaving}
          onGoToFrame={(frameNumber) => {
            if (frameNumber === currentFrame) {
              return;
            }

            void runAction(async () => {
              const saved = await saveFrameScores(currentFrame);
              if (!saved) {
                return;
              }

              setCurrentFrame(frameNumber);
            });
          }}
        />
      </ScoringBoard>

      <div className="flex-1 w-full max-w-lg mx-auto px-4 py-3.5 flex flex-col gap-3">
        {players.map((player) => {
          const history = frameNumbers.filter(
            (frameNumber) => frameNumber !== currentFrame && getPlayerScore(player, frameNumber) !== null
          );
          return (
            <section
              key={player.event_player_id}
              aria-label={player.full_name}
              className="bg-card rounded-2xl border p-3.5"
            >
              <PuttScoreRow
                label={player.full_name}
                badge={player.zone != null ? <ZoneBadge zone={player.zone} distanceFt={player.putt_distance_ft} size="sm" /> : undefined}
                subtitle={player.player_number ? `#${player.player_number}` : undefined}
                aside={
                  <span className="flex flex-col items-end">
                    <span className="font-score text-2xl leading-none font-bold tabular-nums">{player.total_points}</span>
                    <span className="text-[11px] text-muted-foreground">pts total</span>
                  </span>
                }
                score={getPlayerScore(player, currentFrame)}
                bonusPointEnabled={bonusPointEnabled}
                frameNumber={currentFrame}
                disabled={isSaving}
                onChange={(puttsMade) => handleScoreChange(player.event_player_id, currentFrame, puttsMade)}
              >
                {history.length > 0 && (
                  <div className="flex flex-wrap gap-1 text-xs text-muted-foreground">
                    {history.map((frameNumber) => {
                      const putts = getPlayerScore(player, frameNumber) ?? 0;
                      return (
                        <span key={frameNumber} className="rounded-md bg-muted px-2 py-0.5">
                          F{frameNumber}{' '}
                          <strong className="font-score text-sm text-foreground tabular-nums">
                            {calculatePoints(putts, bonusPointEnabled)}
                          </strong>
                        </span>
                      );
                    })}
                  </div>
                )}
              </PuttScoreRow>
            </section>
          );
        })}
      </div>

      <ScoringFooter>
        <p
          className={cn(
            'text-center text-[13px] font-medium',
            frameComplete ? 'text-success' : 'text-muted-foreground'
          )}
        >
          {frameComplete
            ? `Frame ${currentFrame} complete`
            : 'Enter scores for all selected players to continue'}
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            className="flex-1 h-[54px] rounded-[14px] text-base"
            onClick={() =>
              void runAction(async () => {
                const saved = await saveFrameScores(currentFrame);
                if (!saved || currentFrame === 1) {
                  return;
                }

                setCurrentFrame((previousFrame) => previousFrame - 1);
              })
            }
            disabled={currentFrame === 1 || isSaving}
          >
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Prev'}
          </Button>

          {allFramesComplete ? (
            <Button
              className="flex-[2] h-[54px] rounded-[14px] text-base"
              onClick={() =>
                void runAction(async () => {
                  const saved = await saveFrameScores(currentFrame);
                  if (!saved) {
                    return;
                  }

                  setWizardStage('review');
                })
              }
              disabled={isSaving}
            >
              {isSaving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  Review
                  <ArrowRight className="size-[18px]" />
                </>
              )}
            </Button>
          ) : (
            <Button
              className="flex-[2] h-[54px] rounded-[14px] text-base"
              onClick={() =>
                void runAction(async () => {
                  const saved = await saveFrameScores(currentFrame);
                  if (!saved || !frameComplete) {
                    return;
                  }

                  setCurrentFrame((previousFrame) =>
                    Math.min(previousFrame + 1, frameNumbers[frameNumbers.length - 1] ?? previousFrame)
                  );
                })
              }
              disabled={!frameComplete || isSaving}
            >
              {isSaving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  Next frame
                  <ArrowRight className="size-[18px]" />
                </>
              )}
            </Button>
          )}
        </div>
      </ScoringFooter>
    </div>
  );
}
