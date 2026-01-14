'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, CheckCircle2, RefreshCw } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { useToast } from '@/components/ui/use-toast';

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

  const puttOptions = [0, 1, 2, 3];

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <Button variant="ghost" onClick={handleBack}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => accessCode && fetchPlayerData(accessCode)}
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
        </div>

        {/* Player Info Card */}
        <Card className="mb-6">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  {player.full_name}
                  {player.is_complete && (
                    <CheckCircle2 className="h-5 w-5 text-green-500" />
                  )}
                </CardTitle>
                <CardDescription>
                  {player.player_number ? `#${player.player_number}` : 'Qualification Round'}
                </CardDescription>
              </div>
              <div className="text-right">
                <div className="text-3xl font-bold font-mono">{player.total_points}</div>
                <div className="text-sm text-muted-foreground">points</div>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>Frames</span>
                <span>
                  {player.frames_completed} / {player.total_frames_required}
                </span>
              </div>
              <Progress
                value={(player.frames_completed / player.total_frames_required) * 100}
              />
            </div>
          </CardContent>
        </Card>

        {/* Scoring Section */}
        {!player.is_complete && (
          <Card className="mb-6">
            <CardHeader>
              <CardTitle>Frame {nextFrameNumber}</CardTitle>
              <CardDescription>
                How many putts were made?
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-4 gap-3 mb-4">
                {puttOptions.map((putts) => (
                  <Button
                    key={putts}
                    variant={selectedPutts === putts ? 'default' : 'outline'}
                    size="lg"
                    className="h-16 text-2xl font-bold"
                    onClick={() => setSelectedPutts(putts)}
                    disabled={isSaving}
                  >
                    {putts}
                  </Button>
                ))}
              </div>

              {selectedPutts !== null && (
                <div className="text-center text-sm text-muted-foreground mb-4">
                  {selectedPutts === 3
                    ? event?.bonus_point_enabled
                      ? '4 points (3 putts + bonus)'
                      : '3 points'
                    : `${selectedPutts} point${selectedPutts === 1 ? '' : 's'}`}
                </div>
              )}

              <Button
                className="w-full"
                size="lg"
                onClick={handleRecordScore}
                disabled={selectedPutts === null || isSaving}
              >
                {isSaving ? 'Recording...' : 'Record Score'}
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Completed Message */}
        {player.is_complete && (
          <Card className="mb-6 border-green-200 bg-green-50 dark:bg-green-950/20">
            <CardContent className="pt-6 text-center">
              <CheckCircle2 className="h-12 w-12 text-green-500 mx-auto mb-3" />
              <h3 className="text-xl font-semibold text-green-700 dark:text-green-400">
                Qualification Complete!
              </h3>
              <p className="text-green-600 dark:text-green-500 mt-1">
                Total Score: {player.total_points} points
              </p>
              <Button className="mt-4" onClick={handleBack}>
                Back to Players
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Frame History */}
        {frames.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Frame History</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {frames.map((frame) => (
                  <div
                    key={frame.id}
                    className="flex items-center justify-between py-2 border-b last:border-0"
                  >
                    <div className="flex items-center gap-3">
                      <Badge variant="outline">Frame {frame.frame_number}</Badge>
                      <span className="text-muted-foreground">
                        {frame.putts_made} putt{frame.putts_made !== 1 ? 's' : ''}
                      </span>
                    </div>
                    <div className="font-mono font-semibold">
                      {frame.points_earned} pt{frame.points_earned !== 1 ? 's' : ''}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
