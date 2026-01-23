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

      <div className="space-y-4">
        {teams.map((team) => {
          const poolAMember = team.team_members.find(member => member.role === 'A_pool');
          const poolBMember = team.team_members.find(member => member.role === 'B_pool');

          // Score calculation logic simplified for display
          const poolAScore = poolAMember?.event_player.pfa_score;
          const poolBScore = poolBMember?.event_player.pfa_score;
          const poolAHasScore = poolAMember?.event_player.scoring_method !== 'default' && poolAScore != null;
          const poolBHasScore = poolBMember?.event_player.scoring_method !== 'default' && poolBScore != null;
          const combinedScore = (poolAScore ?? 0) + (poolBScore ?? 0);

          const formatScore = (score: number | null | undefined, hasScore: boolean) => {
            if (!hasScore) return 'X';
            return score?.toFixed(1) ?? 'X';
          };

          const poolADisplay = formatScore(poolAScore, poolAHasScore);
          const poolBDisplay = formatScore(poolBScore, poolBHasScore);

          return (
            <div key={team.id} className="flex items-center justify-between p-4 rounded-lg border bg-card text-card-foreground shadow-sm">
              <div className="flex items-center gap-6">
                {/* Team Identifier */}
                <div className="flex flex-col">
                  <span className="text-lg font-bold text-primary">#{team.seed}</span>
                </div>

                {/* Team Members */}
                <div className="flex gap-8">
                  {/* Pool A */}
                  <div className="flex flex-col">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge className="h-5 w-5 p-0 flex items-center justify-center text-[10px]">A</Badge>
                      <span className="font-medium text-sm">
                        {poolAMember ? poolAMember.event_player.player.full_name : "TBD"}
                      </span>
                    </div>
                    <span className="text-xs text-muted-foreground ml-7">Score: {poolADisplay}</span>
                  </div>

                  {/* Pool B */}
                  <div className="flex flex-col">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge className="h-5 w-5 p-0 flex items-center justify-center text-[10px] bg-blue-500 hover:bg-blue-600">B</Badge>
                      <span className="font-medium text-sm">
                        {poolBMember ? poolBMember.event_player.player.full_name : "TBD"}
                      </span>
                    </div>
                    <span className="text-xs text-muted-foreground ml-7">Score: {poolBDisplay}</span>
                  </div>
                </div>
              </div>

              {/* Combined Score */}
              <div className="text-right">
                <div className="text-2xl font-bold font-mono">
                  {(!poolAHasScore || !poolBHasScore) ? (
                    <span className="text-muted-foreground text-base">Incomplete</span>
                  ) : (
                    combinedScore.toFixed(1)
                  )}
                </div>
                <span className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Total</span>
              </div>
            </div>
          );
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
              <li>• Scores based on PFA (Per Frame Average) from the last 6 months</li>
              <li>• Players with no frame history show &quot;X&quot; and are assigned pools by default pool setting</li>
            </>
          )}
        </ul>
      </div>
    </div>
  );
}
