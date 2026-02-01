'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Check } from 'lucide-react';
import { cn } from '@/lib/utils/utils';
import { useToast } from '@/components/ui/use-toast';
import { ScoreInput } from '@/components/ui/score-input';

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

export default function QualificationScoringPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [accessCode, setAccessCode] = useState<string | null>(null);
  const [event, setEvent] = useState<EventInfo | null>(null);
  const [round, setRound] = useState<RoundInfo | null>(null);
  const [players, setPlayers] = useState<PlayerInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isSavingRef = useRef(false);

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
      fetchPlayersData(code, selectedPlayers);
    } catch {
      router.push('/score/qualification');
    }
  }, [router, fetchPlayersData]);

  const handleScoreChange = async (
    eventPlayerId: string,
    frameNumber: number,
    puttsMade: number
  ) => {
    if (!accessCode) return;

    const saveKey = `${eventPlayerId}-${frameNumber}`;
    setIsSaving(saveKey);
    isSavingRef.current = true;

    try {
      const response = await fetch(`/api/score/qualification/${eventPlayerId}`, {
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
        throw new Error(data.error || 'Failed to save score');
      }

      const result = await response.json();

      // Update local state
      setPlayers((prev) =>
        prev.map((p) => {
          if (p.event_player_id === eventPlayerId) {
            const existingFrameIndex = p.frames.findIndex(
              (f) => f.frame_number === frameNumber
            );
            const newFrames =
              existingFrameIndex >= 0
                ? p.frames.map((f, i) =>
                    i === existingFrameIndex ? result.frame : f
                  )
                : [...p.frames, result.frame].sort(
                    (a, b) => a.frame_number - b.frame_number
                  );

            return {
              ...p,
              frames: newFrames,
              frames_completed: result.player.frames_completed,
              total_points: result.player.total_points,
              is_complete: result.player.is_complete,
            };
          }
          return p;
        })
      );
    } catch (err) {
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to save score',
      });
    } finally {
      setIsSaving(null);
      isSavingRef.current = false;
    }
  };

  const handleBack = () => {
    sessionStorage.removeItem('qualification_selected_players');
    router.push('/score/qualification');
  };

  const handleDone = () => {
    sessionStorage.removeItem('qualification_selected_players');
    router.push('/score/qualification');
  };

  const getPlayerScore = (player: PlayerInfo, frameNumber: number): number | null => {
    const frame = player.frames.find((f) => f.frame_number === frameNumber);
    return frame?.putts_made ?? null;
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

  const frameCount = round.frame_count;
  const frameNumbers = Array.from({ length: frameCount }, (_, i) => i + 1);
  const allComplete = players.every((p) => p.is_complete);

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

        {/* Event Info */}
        <Card className="mb-6">
          <CardContent className="pt-6">
            <div className="text-center">
              <div className="text-sm text-muted-foreground mb-1">
                {event?.location && `${event.location} - `}
                {event?.event_date && new Date(event.event_date).toLocaleDateString()}
              </div>
              <div className="text-lg font-semibold">
                Scoring {players.length} Player{players.length !== 1 ? 's' : ''}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Scoring Table */}
        <Card className="mb-6 overflow-hidden">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">Frame Scores</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left p-3 font-medium">Player</th>
                    {frameNumbers.map((num) => (
                      <th
                        key={num}
                        className="text-center p-3 font-medium min-w-[60px]"
                      >
                        {num}
                      </th>
                    ))}
                    <th className="text-center p-3 font-medium bg-muted min-w-[70px]">
                      Total
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {players.map((player) => (
                    <PlayerRow
                      key={player.event_player_id}
                      player={player}
                      frameNumbers={frameNumbers}
                      getScore={getPlayerScore}
                      onScoreChange={handleScoreChange}
                      isSaving={isSaving}
                      bonusPointEnabled={event?.bonus_point_enabled ?? false}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Done Button */}
        <div className="text-center">
          <Button
            size="lg"
            onClick={handleDone}
            disabled={!allComplete}
            className="min-w-[200px]"
          >
            <Check className="mr-2 h-4 w-4" />
            Submit Scores
          </Button>
          {!allComplete && (
            <p className="text-sm text-muted-foreground mt-2">
              All players must complete {frameCount} frames before submitting
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

interface PlayerRowProps {
  player: PlayerInfo;
  frameNumbers: number[];
  getScore: (player: PlayerInfo, frameNumber: number) => number | null;
  onScoreChange: (eventPlayerId: string, frameNumber: number, puttsMade: number) => void;
  isSaving: string | null;
  bonusPointEnabled: boolean;
}

function PlayerRow({
  player,
  frameNumbers,
  getScore,
  onScoreChange,
  isSaving,
  bonusPointEnabled,
}: PlayerRowProps) {
  return (
    <tr className={cn("border-b", player.is_complete && "bg-green-50/50 dark:bg-green-950/20")}>
      <td className="p-3">
        <div className="font-medium">{player.full_name}</div>
        <div className="text-xs text-muted-foreground">
          {player.player_number ? `#${player.player_number}` : ''}
          {player.is_complete && (
            <Badge variant="outline" className="ml-2 text-green-600 border-green-300">
              Complete
            </Badge>
          )}
        </div>
      </td>
      {frameNumbers.map((frameNum) => {
        const score = getScore(player, frameNum);
        const saveKey = `${player.event_player_id}-${frameNum}`;
        const isCurrentlySaving = isSaving === saveKey;

        return (
          <td key={frameNum} className="text-center p-1">
            <ScoreInput
              value={score}
              onChange={(val) => onScoreChange(player.event_player_id, frameNum, val)}
              disabled={isCurrentlySaving}
              isSaving={isCurrentlySaving}
              bonusPointEnabled={bonusPointEnabled}
            />
          </td>
        );
      })}
      <td className="text-center p-3 bg-muted font-mono font-bold text-lg">
        {player.total_points}
      </td>
    </tr>
  );
}

