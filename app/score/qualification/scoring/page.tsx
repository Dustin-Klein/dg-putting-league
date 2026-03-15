'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ArrowRight, Check, ChevronLeft, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/use-toast';
import { formatDisplayDate } from '@/lib/utils/date-utils';
import { FrameNavigation } from '@/app/score/components/scoring-wizard/frame-navigation';
import { ScoreStepperRow } from '@/app/score/components/scoring-wizard/score-stepper-row';
import {
  getResolvedScore,
  getScoreKey,
  getSequentialFrameNumbers,
  type ScoreState,
} from '@/app/score/components/scoring-wizard/scoring-utils';
import { useWizardActionState } from '@/app/score/components/scoring-wizard/use-wizard-action-state';
import { QualificationReviewSubmit } from './components/review-submit';

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
      const responses = await Promise.all(
        frameEntries.map(async ({ player, puttsMade }) => {
          const response = await fetch(`/api/score/qualification/${player.event_player_id}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              access_code: accessCode,
              frame_number: frameNumber,
              putts_made: puttsMade,
            }),
          });

          if (!response.ok) {
            const data = await response.json();
            throw new Error(data.error || `Failed to save score for ${player.full_name}`);
          }

          return response.json() as Promise<{
            frame: FrameInfo;
            player: Omit<PlayerInfo, 'frames'>;
          }>;
        })
      );

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
          setCurrentFrame(frameNumber);
          setWizardStage('scoring');
        }}
        onBack={() => setWizardStage('scoring')}
      />
    );
  }

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-4">
          <Button variant="ghost" onClick={handleBack}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
          <Badge>Qualification</Badge>
        </div>

        <Card className="mb-4">
          <CardContent className="pt-6">
            <div className="text-center">
              <div className="text-sm text-muted-foreground mb-1">
                {event?.location && `${event.location} - `}
                {event?.event_date && formatDisplayDate(event.event_date)}
              </div>
              <div className="text-lg font-semibold">
                Frame {currentFrame} of {round.frame_count}
              </div>
              <div className="text-sm text-muted-foreground mt-1">
                Scoring {players.length} Player{players.length !== 1 ? 's' : ''}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="mb-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">Qualification Scores</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {players.map((player) => (
              <ScoreStepperRow
                key={player.event_player_id}
                label={player.full_name}
                subtitle={
                  player.player_number
                    ? `#${player.player_number} • ${player.total_points} pts total`
                    : `${player.total_points} pts total`
                }
                score={getPlayerScore(player, currentFrame)}
                bonusPointEnabled={event?.bonus_point_enabled ?? false}
                disabled={isSaving}
                onChange={(puttsMade) => handleScoreChange(player.event_player_id, currentFrame, puttsMade)}
              />
            ))}
          </CardContent>
        </Card>

        <FrameNavigation
          frameNumbers={frameNumbers}
          currentFrame={currentFrame}
          standardFrames={round.frame_count}
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

        <div className="flex gap-2 sticky bottom-0 mt-auto pt-2 pb-1 bg-background">
          <Button
            variant="outline"
            className="flex-1 h-12"
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
            {isSaving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <ChevronLeft className="mr-1 h-4 w-4" />
                Prev
              </>
            )}
          </Button>

          {allFramesComplete ? (
            <Button
              className="flex-1 h-12"
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
                  <Check className="ml-1 h-4 w-4" />
                </>
              )}
            </Button>
          ) : (
            <Button
              className="flex-1 h-12"
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
                  Next
                  <ArrowRight className="ml-1 h-4 w-4" />
                </>
              )}
            </Button>
          )}
        </div>

        {!frameComplete && (
          <p className="text-xs text-muted-foreground text-center mt-1">
            Enter scores for all selected players to continue
          </p>
        )}
      </div>
    </div>
  );
}
