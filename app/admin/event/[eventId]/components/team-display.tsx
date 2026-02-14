import { Badge } from '@/components/ui/badge';
import { EventWithDetails } from '@/lib/types/event';
import { Trophy, Users } from 'lucide-react';

interface TeamDisplayProps {
  event: EventWithDetails;
  isAdmin?: boolean;
}

export function TeamDisplay({ event }: TeamDisplayProps) {
  const teams = event.teams || [];

  if (teams.length === 0) {
    return (
      <div className="text-center py-12">
        <Users className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
        <h3 className="text-lg font-medium text-muted-foreground mb-2">No Teams Generated</h3>
        <p className="text-sm text-muted-foreground">
          Teams will be generated when the event status changes to bracket play.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold flex items-center gap-2">
          <Trophy className="h-6 w-6" />
          Teams
        </h2>
        <Badge variant="secondary">
          {teams.length} teams
        </Badge>
      </div>

      <div className="grid grid-flow-col auto-cols-fr gap-x-4 gap-y-1" style={{ gridTemplateRows: `auto repeat(${Math.min(teams.length, 10)}, minmax(0, 1fr))` }}>
        {Array.from({ length: Math.ceil(teams.length / 10) }, (_, colIndex) => {
          const columnTeams = teams.slice(colIndex * 10, (colIndex + 1) * 10);
          return [
            <div key={`header-${colIndex}`} className="flex items-center gap-2 px-2.5 py-1 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              <span className="w-7 shrink-0">Seed</span>
              <span className="flex-1 text-center">Pool A</span>
              <span className="flex-1 text-center">Pool B</span>
              <span className="w-10 text-right shrink-0">Total</span>
            </div>,
            ...columnTeams.map((team) => {
              const poolAMember = team.team_members.find(member => member.role === 'A_pool');
              const poolBMember = team.team_members.find(member => member.role === 'B_pool');

              const poolAScore = poolAMember?.event_player.pfa_score;
              const poolBScore = poolBMember?.event_player.pfa_score;
              const poolAHasScore = poolAMember?.event_player.scoring_method !== 'default' && poolAScore != null;
              const poolBHasScore = poolBMember?.event_player.scoring_method !== 'default' && poolBScore != null;
              const combinedScore = (poolAScore ?? 0) + (poolBScore ?? 0);

              const formatScore = (score: number | null | undefined, hasScore: boolean) => {
                if (!hasScore) return 'X';
                return score?.toFixed(2) ?? 'X';
              };

              return (
                <div key={team.id} className="flex items-center gap-2 px-2.5 py-1.5 rounded border bg-card text-card-foreground text-sm">
                  <span className="font-bold text-primary w-7 shrink-0">#{team.seed}</span>
                  <div className="flex items-center gap-1 min-w-0 flex-1">
                    <Badge className="h-4 w-4 p-0 flex items-center justify-center text-[9px] shrink-0">A</Badge>
                    <span className="truncate font-medium">
                      {poolAMember?.event_player?.player?.full_name ?? "TBD"}
                    </span>
                    <span className="text-[10px] text-muted-foreground shrink-0">({formatScore(poolAScore, poolAHasScore)})</span>
                  </div>
                  <div className="flex items-center gap-1 min-w-0 flex-1">
                    <Badge className="h-4 w-4 p-0 flex items-center justify-center text-[9px] bg-blue-500 hover:bg-blue-600 shrink-0">B</Badge>
                    <span className="truncate font-medium">
                      {poolBMember?.event_player?.player?.full_name ?? "TBD"}
                    </span>
                    <span className="text-[10px] text-muted-foreground shrink-0">({formatScore(poolBScore, poolBHasScore)})</span>
                  </div>
                  <span className="font-mono font-bold text-xs shrink-0 w-10 text-right">
                    {(!poolAHasScore || !poolBHasScore) ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      combinedScore.toFixed(2)
                    )}
                  </span>
                </div>
              );
            }),
          ];
        })}
      </div>

      <div className="bg-muted/50 rounded-lg p-4">
        <h3 className="font-medium mb-2">Team Generation Details</h3>
        <ul className="text-sm text-muted-foreground space-y-1">
          <li>• Teams are formed with 1 player from Pool A and 1 player from Pool B</li>
          <li>• Teams are seeded based on combined scores (lower seed = higher combined score)</li>
          {event.qualification_round_enabled ? (
            <li>• Scores based on qualification round performance</li>
          ) : (
            <>
              <li>• Scores based on PFA (Per Frame Average) from the last 18 months</li>
              <li>• Players with no frame history show &quot;X&quot; and are assigned pools by default pool setting</li>
            </>
          )}
        </ul>
      </div>
    </div>
  );
}
