'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Check, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils/utils';

interface PlayerInfo {
  event_player_id: string;
  role: 'A_pool' | 'B_pool';
  full_name: string;
  nickname: string | null;
}

interface TeamInfo {
  id: string;
  seed: number;
  pool_combo: string;
  players: PlayerInfo[];
}

interface FrameResult {
  id: string;
  event_player_id: string;
  putts_made: number;
  points_earned: number;
}

interface FrameInfo {
  id: string;
  frame_number: number;
  is_overtime: boolean;
  results: FrameResult[];
}

interface MatchInfo {
  id: string;
  bracket_match_id: number;
  round_name: string;
  status: string;
  team_one: TeamInfo;
  team_two: TeamInfo;
  team_one_score: number;
  team_two_score: number;
  frames: FrameInfo[];
}

const STANDARD_FRAMES = 5;

export default function MatchScoringPage({
  params,
}: {
  params: Promise<{ matchId: string }>;
}) {
  const router = useRouter();
  const [matchId, setMatchId] = useState<string | null>(null);
  const [accessCode, setAccessCode] = useState<string | null>(null);
  const [bonusPointEnabled, setBonusPointEnabled] = useState(true);
  const [match, setMatch] = useState<MatchInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState<string | null>(null);
  const [isCompleting, setIsCompleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Track if we're currently saving to avoid refetch during our own updates
  const isSavingRef = useRef(false);

  // Resolve params
  useEffect(() => {
    params.then((p) => setMatchId(p.matchId));
  }, [params]);

  const fetchMatch = useCallback(async (code: string, id: string, showLoading = true) => {
    try {
      if (showLoading) {
        setIsLoading(true);
      }
      const response = await fetch(`/api/score/match/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ access_code: code }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to load match');
      }

      const data = await response.json();
      setMatch(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load match');
    } finally {
      if (showLoading) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    const code = sessionStorage.getItem('scoring_access_code');
    if (!code) {
      router.push('/score');
      return;
    }
    setAccessCode(code);

    // Get bonus point setting from event
    const fetchEvent = async () => {
      const response = await fetch('/api/score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ access_code: code }),
      });
      if (response.ok) {
        const data = await response.json();
        setBonusPointEnabled(data.event.bonus_point_enabled);
      }
    };
    fetchEvent();
  }, [router]);

  useEffect(() => {
    if (accessCode && matchId) {
      fetchMatch(accessCode, matchId, true);
    }
  }, [accessCode, matchId, fetchMatch]);

  // Realtime subscription for frame_results changes
  useEffect(() => {
    if (!matchId || !accessCode) return;

    const supabase = createClient();
    const bracketMatchId = parseInt(matchId, 10);

    if (isNaN(bracketMatchId)) return;

    const channel = supabase
      .channel(`public-match-scoring-${bracketMatchId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'frame_results',
          filter: `bracket_match_id=eq.${bracketMatchId}`,
        },
        () => {
          // Only refetch if we're not the one saving
          if (!isSavingRef.current) {
            fetchMatch(accessCode, matchId, false);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [matchId, accessCode, fetchMatch]);

  const handleScoreChange = async (
    eventPlayerId: string,
    frameNumber: number,
    puttsMade: number
  ) => {
    if (!accessCode || !matchId) return;

    const saveKey = `${eventPlayerId}-${frameNumber}`;
    setIsSaving(saveKey);
    isSavingRef.current = true;

    try {
      const response = await fetch(`/api/score/match/${matchId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          access_code: accessCode,
          frame_number: frameNumber,
          event_player_id: eventPlayerId,
          putts_made: puttsMade,
          bonus_point_enabled: bonusPointEnabled,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to save score');
      }

      const updatedMatch = await response.json();
      setMatch(updatedMatch);
    } catch (err) {
      console.error('Failed to save score:', err);
    } finally {
      setIsSaving(null);
      isSavingRef.current = false;
    }
  };

  const handleComplete = async () => {
    if (!accessCode || !matchId || !match) return;

    if (match.team_one_score === match.team_two_score) {
      setError('Scores are tied. Continue scoring in overtime until there is a winner.');
      return;
    }

    setIsCompleting(true);
    setError(null);

    try {
      const response = await fetch(`/api/score/match/${matchId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ access_code: accessCode }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to complete match');
      }

      router.push('/score/matches');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to complete match');
    } finally {
      setIsCompleting(false);
    }
  };

  const getPlayerScore = (eventPlayerId: string, frameNumber: number): number | null => {
    const frame = match?.frames.find((f) => f.frame_number === frameNumber);
    const result = frame?.results.find((r) => r.event_player_id === eventPlayerId);
    return result?.putts_made ?? null;
  };

  const getPlayerTotalPoints = (eventPlayerId: string): number => {
    let total = 0;
    for (const frame of match?.frames || []) {
      const result = frame.results.find((r) => r.event_player_id === eventPlayerId);
      if (result) {
        total += result.points_earned;
      }
    }
    return total;
  };

  // Determine how many frames to show (at least 5, plus any overtime)
  const maxFrameNumber = Math.max(
    STANDARD_FRAMES,
    ...(match?.frames.map((f) => f.frame_number) || [])
  );
  const frameNumbers = Array.from({ length: maxFrameNumber }, (_, i) => i + 1);

  // Check if we need to add overtime frame
  const needsOvertime =
    match &&
    match.team_one_score === match.team_two_score &&
    match.frames.length >= STANDARD_FRAMES &&
    match.frames.every((f) => f.results.length === 4);

  if (needsOvertime && frameNumbers.length === maxFrameNumber) {
    frameNumbers.push(maxFrameNumber + 1);
  }

  if (isLoading || !match) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground">Loading match...</div>
      </div>
    );
  }

  const allPlayers = [
    ...match.team_one.players.map((p) => ({ ...p, teamId: match.team_one.id, teamName: match.team_one.pool_combo })),
    ...match.team_two.players.map((p) => ({ ...p, teamId: match.team_two.id, teamName: match.team_two.pool_combo })),
  ];

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-4">
          <Button variant="ghost" onClick={() => router.push('/score/matches')}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
          <Badge variant={match.status === 'completed' ? 'secondary' : 'default'}>
            {match.status === 'completed' ? 'Completed' : match.round_name}
          </Badge>
        </div>

        {/* Score Summary */}
        <Card className="mb-6">
          <CardContent className="pt-6">
            <div className="flex items-center justify-around text-center">
              <div>
                <div className="text-sm text-muted-foreground mb-1">
                  #{match.team_one.seed} {match.team_one.pool_combo}
                </div>
                <div className={cn(
                  "text-4xl font-mono font-bold",
                  match.team_one_score > match.team_two_score && "text-green-600"
                )}>
                  {match.team_one_score}
                </div>
              </div>
              <div className="text-2xl text-muted-foreground">vs</div>
              <div>
                <div className="text-sm text-muted-foreground mb-1">
                  #{match.team_two.seed} {match.team_two.pool_combo}
                </div>
                <div className={cn(
                  "text-4xl font-mono font-bold",
                  match.team_two_score > match.team_one_score && "text-green-600"
                )}>
                  {match.team_two_score}
                </div>
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
                        className={cn(
                          "text-center p-3 font-medium min-w-[60px]",
                          num > STANDARD_FRAMES && "bg-yellow-50 dark:bg-yellow-950/20"
                        )}
                      >
                        {num > STANDARD_FRAMES ? `OT${num - STANDARD_FRAMES}` : num}
                      </th>
                    ))}
                    <th className="text-center p-3 font-medium bg-muted min-w-[70px]">
                      Total
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {/* Team 1 */}
                  <tr className="bg-blue-50/50 dark:bg-blue-950/20">
                    <td
                      colSpan={frameNumbers.length + 2}
                      className="p-2 text-xs font-semibold text-muted-foreground"
                    >
                      {match.team_one.pool_combo}
                    </td>
                  </tr>
                  {match.team_one.players.map((player) => (
                    <PlayerRow
                      key={player.event_player_id}
                      player={player}
                      frameNumbers={frameNumbers}
                      getScore={getPlayerScore}
                      getTotalPoints={getPlayerTotalPoints}
                      onScoreChange={handleScoreChange}
                      isSaving={isSaving}
                      isCompleted={match.status === 'completed'}
                    />
                  ))}

                  {/* Team 2 */}
                  <tr className="bg-orange-50/50 dark:bg-orange-950/20">
                    <td
                      colSpan={frameNumbers.length + 2}
                      className="p-2 text-xs font-semibold text-muted-foreground"
                    >
                      {match.team_two.pool_combo}
                    </td>
                  </tr>
                  {match.team_two.players.map((player) => (
                    <PlayerRow
                      key={player.event_player_id}
                      player={player}
                      frameNumbers={frameNumbers}
                      getScore={getPlayerScore}
                      getTotalPoints={getPlayerTotalPoints}
                      onScoreChange={handleScoreChange}
                      isSaving={isSaving}
                      isCompleted={match.status === 'completed'}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {error && (
          <div className="mb-4 p-3 bg-destructive/10 text-destructive rounded-md text-sm text-center">
            {error}
          </div>
        )}

        {/* Complete Button */}
        {match.status !== 'completed' && (
          <div className="text-center">
            <Button
              size="lg"
              onClick={handleComplete}
              disabled={isCompleting || match.team_one_score === match.team_two_score}
              className="min-w-[200px]"
            >
              {isCompleting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Completing...
                </>
              ) : (
                <>
                  <Check className="mr-2 h-4 w-4" />
                  Complete Match
                </>
              )}
            </Button>
            {match.team_one_score === match.team_two_score && (
              <p className="text-sm text-muted-foreground mt-2">
                Scores are tied. Continue scoring until there is a winner.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

interface PlayerRowProps {
  player: PlayerInfo;
  frameNumbers: number[];
  getScore: (eventPlayerId: string, frameNumber: number) => number | null;
  getTotalPoints: (eventPlayerId: string) => number;
  onScoreChange: (eventPlayerId: string, frameNumber: number, puttsMade: number) => void;
  isSaving: string | null;
  isCompleted: boolean;
}

function PlayerRow({
  player,
  frameNumbers,
  getScore,
  getTotalPoints,
  onScoreChange,
  isSaving,
  isCompleted,
}: PlayerRowProps) {
  return (
    <tr className="border-b">
      <td className="p-3">
        <div className="font-medium">{player.full_name}</div>
        <div className="text-xs text-muted-foreground">
          {player.role === 'A_pool' ? 'Pool A' : 'Pool B'}
        </div>
      </td>
      {frameNumbers.map((frameNum) => {
        const score = getScore(player.event_player_id, frameNum);
        const saveKey = `${player.event_player_id}-${frameNum}`;
        const isCurrentlySaving = isSaving === saveKey;

        return (
          <td
            key={frameNum}
            className={cn(
              "text-center p-1",
              frameNum > 5 && "bg-yellow-50/50 dark:bg-yellow-950/10"
            )}
          >
            <ScoreInput
              value={score}
              onChange={(val) => onScoreChange(player.event_player_id, frameNum, val)}
              disabled={isCompleted || isCurrentlySaving}
              isSaving={isCurrentlySaving}
            />
          </td>
        );
      })}
      <td className="text-center p-3 bg-muted font-mono font-bold text-lg">
        {getTotalPoints(player.event_player_id)}
      </td>
    </tr>
  );
}

interface ScoreInputProps {
  value: number | null;
  onChange: (value: number) => void;
  disabled: boolean;
  isSaving: boolean;
}

function ScoreInput({ value, onChange, disabled, isSaving }: ScoreInputProps) {
  const options = [0, 1, 2, 3];

  return (
    <div className="relative">
      <select
        value={value ?? ''}
        onChange={(e) => {
          const val = parseInt(e.target.value, 10);
          if (!isNaN(val)) {
            onChange(val);
          }
        }}
        disabled={disabled}
        className={cn(
          "w-12 h-10 text-center text-lg font-mono rounded border",
          "bg-background focus:ring-2 focus:ring-primary focus:border-primary",
          "disabled:opacity-50 disabled:cursor-not-allowed",
          value !== null && "font-bold",
          value === 3 && "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400"
        )}
      >
        <option value="">-</option>
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
      {isSaving && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/50">
          <Loader2 className="h-4 w-4 animate-spin" />
        </div>
      )}
    </div>
  );
}
