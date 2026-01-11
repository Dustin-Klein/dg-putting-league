'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Play, Users } from 'lucide-react';
import { cn } from '@/lib/utils/utils';
import type { MatchInfo, PlayerInfo, TeamInfo } from './wizard-types';

interface MatchSetupProps {
  match: MatchInfo;
  onBeginScoring: () => void;
  onBack: () => void;
}

export function MatchSetup({ match, onBeginScoring, onBack }: MatchSetupProps) {
  return (
    <div className="min-h-screen bg-background p-4">
      <div className="max-w-lg mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <Button variant="ghost" onClick={onBack}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
          <Badge variant={match.status === 'completed' ? 'secondary' : 'default'}>
            {match.status === 'completed' ? 'Completed' : match.round_name}
          </Badge>
        </div>

        {/* Match Info Card */}
        <Card className="mb-6">
          <CardHeader className="text-center pb-2">
            <CardTitle className="text-xl">Match Setup</CardTitle>
            <CardDescription>
              Verify the teams before starting
            </CardDescription>
          </CardHeader>
          <CardContent>
            {/* Score Display */}
            <div className="flex items-center justify-around text-center mb-6 py-4 bg-muted/30 rounded-lg">
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

        {/* Team 1 */}
        <TeamCard team={match.team_one} teamNumber={1} />

        {/* Team 2 */}
        <TeamCard team={match.team_two} teamNumber={2} />

        {/* Begin Scoring Button */}
        <div className="mt-8">
          <Button
            size="lg"
            className="w-full h-14 text-lg"
            onClick={onBeginScoring}
            disabled={match.status === 'completed'}
          >
            <Play className="mr-2 h-5 w-5" />
            {match.status === 'completed' ? 'Match Completed' : 'Begin Scoring'}
          </Button>
          {match.status !== 'completed' && (
            <p className="text-sm text-muted-foreground text-center mt-3">
              You&apos;ll score one frame at a time
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

interface TeamCardProps {
  team: TeamInfo;
  teamNumber: 1 | 2;
}

function TeamCard({ team, teamNumber }: TeamCardProps) {
  const bgColor = teamNumber === 1
    ? 'bg-blue-50/50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800'
    : 'bg-orange-50/50 dark:bg-orange-950/20 border-orange-200 dark:border-orange-800';

  return (
    <Card className={cn('mb-4', bgColor)}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="h-4 w-4" />
            Team {teamNumber}
          </CardTitle>
          <Badge variant="outline">
            #{team.seed} {team.pool_combo}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="space-y-2">
          {team.players.map((player) => (
            <PlayerDisplay key={player.event_player_id} player={player} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function PlayerDisplay({ player }: { player: PlayerInfo }) {
  return (
    <div className="flex items-center justify-between py-2 px-3 bg-background/60 rounded-md">
      <div>
        <div className="font-medium">{player.full_name}</div>
        {player.nickname && (
          <div className="text-xs text-muted-foreground">&quot;{player.nickname}&quot;</div>
        )}
      </div>
      <Badge variant="secondary" className="text-xs">
        {player.role === 'A_pool' ? 'Pool A' : 'Pool B'}
      </Badge>
    </div>
  );
}
