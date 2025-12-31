'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, RefreshCw } from 'lucide-react';

interface TeamInfo {
  id: string;
  seed: number;
  pool_combo: string;
  players: {
    event_player_id: string;
    role: string;
    full_name: string;
    nickname: string | null;
  }[];
}

interface MatchInfo {
  id: string;
  bracket_match_id: number;
  round_name: string;
  status: string;
  lane_id: string | null;
  lane_label: string | null;
  team_one: TeamInfo;
  team_two: TeamInfo;
  team_one_score: number;
  team_two_score: number;
}

interface EventInfo {
  id: string;
  event_date: string;
  location: string | null;
  lane_count: number;
  bonus_point_enabled: boolean;
  status: string;
}

export default function MatchesPage() {
  const router = useRouter();
  const [accessCode, setAccessCode] = useState<string | null>(null);
  const [event, setEvent] = useState<EventInfo | null>(null);
  const [matches, setMatches] = useState<MatchInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchMatches = useCallback(async (code: string) => {
    try {
      setIsLoading(true);
      const response = await fetch('/api/score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ access_code: code }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to load matches');
      }

      const data = await response.json();
      setEvent(data.event);
      setMatches(data.matches);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load matches');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const code = sessionStorage.getItem('scoring_access_code');
    if (!code) {
      router.push('/score');
      return;
    }
    setAccessCode(code);
    fetchMatches(code);
  }, [router, fetchMatches]);

  const handleSelectMatch = (matchId: string) => {
    router.push(`/score/match/${matchId}`);
  };

  const handleBack = () => {
    sessionStorage.removeItem('scoring_access_code');
    router.push('/score');
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground">Loading matches...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6 text-center">
            <p className="text-destructive mb-4">{error}</p>
            <Button onClick={handleBack}>Back to Access Code</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <Button variant="ghost" onClick={handleBack}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Exit
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => accessCode && fetchMatches(accessCode)}
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
        </div>

        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Available Matches</CardTitle>
            <CardDescription>
              {event?.location && `${event.location} - `}
              {event?.event_date && new Date(event.event_date).toLocaleDateString()}
            </CardDescription>
          </CardHeader>
        </Card>

        {matches.length === 0 ? (
          <Card>
            <CardContent className="pt-6 text-center text-muted-foreground">
              No matches available for scoring right now.
              <br />
              Check back when matches are ready to play.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {matches.map((match) => (
              <Card
                key={match.id}
                className="cursor-pointer hover:border-primary/50 transition-colors"
                onClick={() => handleSelectMatch(match.id)}
              >
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-muted-foreground">
                        {match.round_name}
                      </span>
                      {match.lane_label && (
                        <Badge variant="outline" className="bg-blue-100 text-blue-700 border-blue-200">
                          {match.lane_label}
                        </Badge>
                      )}
                    </div>
                    <Badge
                      variant={match.status === 'in_progress' ? 'default' : 'secondary'}
                    >
                      {match.status === 'in_progress' ? 'In Progress' : 'Ready'}
                    </Badge>
                  </div>

                  <div className="space-y-3">
                    {/* Team 1 */}
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">
                            #{match.team_one.seed}
                          </span>
                          <span className="font-medium">
                            {match.team_one.pool_combo}
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {match.team_one.players.map(p => p.full_name).join(' & ')}
                        </div>
                      </div>
                      <span className="text-2xl font-mono font-bold">
                        {match.team_one_score}
                      </span>
                    </div>

                    <div className="text-center text-xs text-muted-foreground">vs</div>

                    {/* Team 2 */}
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">
                            #{match.team_two.seed}
                          </span>
                          <span className="font-medium">
                            {match.team_two.pool_combo}
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {match.team_two.players.map(p => p.full_name).join(' & ')}
                        </div>
                      </div>
                      <span className="text-2xl font-mono font-bold">
                        {match.team_two_score}
                      </span>
                    </div>
                  </div>

                  <div className="mt-4 text-center">
                    <Button size="sm">Score This Match</Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
