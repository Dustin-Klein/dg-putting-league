'use client';

import type { Match } from 'brackets-model';
import type { Team } from '@/lib/types/team';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils/utils';
import { Status } from 'brackets-model';
import { getStatusLabel, getStatusColor } from '@/lib/types/bracket';

interface OpponentData {
  id: number | null;
  score?: number;
  result?: 'win' | 'loss' | 'draw';
  position?: number;
}

interface MatchCardProps {
  match: Match;
  team1?: Team;
  team2?: Team;
  matchNumber: number;
  laneLabel?: string;
  onClick?: () => void;
  isClickable?: boolean;
}

function getTeamName(team?: Team): string {
  if (!team) return 'TBD';
  return team.pool_combo || `Team ${team.seed}`;
}

function OpponentRow({
  opponent,
  team,
  isWinner,
  showScore,
}: {
  opponent: OpponentData | null;
  team?: Team;
  isWinner: boolean;
  showScore: boolean;
}) {
  if (!opponent || opponent.id === null) {
    return (
      <div className="flex items-center justify-between px-3 py-2 text-sm text-muted-foreground">
        <span className="italic">TBD</span>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'flex items-center justify-between px-3 py-2 text-sm',
        isWinner && 'bg-green-50 dark:bg-green-950/30'
      )}
    >
      <div className="flex items-center gap-2 min-w-0">
        {team?.seed && (
          <span className="text-xs text-muted-foreground font-medium">
            #{team.seed}
          </span>
        )}
        <span
          className={cn(
            'truncate',
            isWinner && 'font-semibold'
          )}
        >
          {getTeamName(team)}
        </span>
      </div>
      {showScore && opponent.score !== undefined && (
        <span
          className={cn(
            'font-mono font-medium',
            isWinner && 'text-green-600 dark:text-green-400'
          )}
        >
          {opponent.score}
        </span>
      )}
    </div>
  );
}

export function MatchCard({
  match,
  team1,
  team2,
  matchNumber,
  laneLabel,
  onClick,
  isClickable = false,
}: MatchCardProps) {
  const opponent1 = match.opponent1 as OpponentData | null;
  const opponent2 = match.opponent2 as OpponentData | null;

const showScore =
  match.status === Status.Running ||
  match.status === Status.Completed ||
  match.status === Status.Archived;
 
const isComplete =
  match.status === Status.Completed ||
  match.status === Status.Archived;

  const team1IsWinner = isComplete && opponent1?.result === 'win';
  const team2IsWinner = isComplete && opponent2?.result === 'win';

  return (
    <Card
      className={cn(
        'w-56 overflow-hidden transition-all',
        isClickable && 'cursor-pointer hover:shadow-md hover:border-primary/50',
        match.status === Status.Running && 'ring-2 ring-blue-400'
      )}
      onClick={isClickable ? onClick : undefined}
    >
      <div className="flex items-center justify-between px-3 py-1.5 bg-muted/50 border-b">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs font-medium text-muted-foreground truncate">
            Match {matchNumber}
          </span>
          {laneLabel && (
            <Badge
              variant="secondary"
              className="text-[10px] px-1.5 py-0 bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300"
            >
              {laneLabel}
            </Badge>
          )}
        </div>
        {showScore && (
          <Badge
            variant="outline"
            className={cn('text-[10px] px-1.5 py-0', getStatusColor(match.status))}
          >
            {getStatusLabel(match.status)}
          </Badge>
        )}
      </div>
      <CardContent className="p-0 divide-y">
        <OpponentRow
          opponent={opponent1}
          team={team1}
          isWinner={team1IsWinner}
          showScore={showScore}
        />
        <OpponentRow
          opponent={opponent2}
          team={team2}
          isWinner={team2IsWinner}
          showScore={showScore}
        />
      </CardContent>
    </Card>
  );
}
