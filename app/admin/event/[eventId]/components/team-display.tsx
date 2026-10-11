import { Badge } from '@/components/ui/badge';
import { PoolBadge } from '@/components/pool-badge';
import { EventWithDetails } from '@/lib/types/event';
import type { TeamMember } from '@/lib/types/team';
import { poolLabel, sortBySlot } from '@/lib/utils/team-utils';
import { Trophy, Users } from 'lucide-react';

interface TeamDisplayProps {
  event: EventWithDetails;
  isAdmin?: boolean;
}

export function TeamDisplay({ event }: TeamDisplayProps) {
  const teams = event.teams || [];
  // Column headers follow the first team's slots: pool names when the event drew
  // from pools, otherwise player positions.
  const slotHeaders = sortBySlot(teams[0]?.team_members ?? []).map((member) =>
    poolLabel(member.event_player.pool) ?? (event.team_size === 1 ? 'Player' : `Player ${member.slot}`)
  );

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
              {slotHeaders.map((header) => (
                <span key={header} className="flex-1 text-center">{header}</span>
              ))}
              <span className="w-10 text-right shrink-0">Total</span>
            </div>,
            ...columnTeams.map((team) => {
              const members = sortBySlot(team.team_members);
              const hasScore = (member: TeamMember) =>
                member.event_player.scoring_method !== 'default' && member.event_player.pfa_score != null;
              const combinedScore = members.reduce((sum, member) => sum + (member.event_player.pfa_score ?? 0), 0);

              return (
                <div key={team.id} className="flex items-center gap-2 px-2.5 py-1.5 rounded border bg-card text-card-foreground text-sm">
                  <span className="font-bold text-primary w-7 shrink-0">#{team.seed}</span>
                  {members.map((member) => (
                    <div key={member.event_player_id} className="flex items-center gap-1 min-w-0 flex-1">
                      <PoolBadge
                        pool={member.event_player.pool}
                        className="h-4 w-4 p-0 flex items-center justify-center text-[9px] shrink-0"
                      />
                      <span className="truncate font-medium">
                        {member.event_player.player.full_name}
                      </span>
                      <span className="text-[10px] text-muted-foreground shrink-0">
                        ({hasScore(member) ? member.event_player.pfa_score!.toFixed(2) : 'X'})
                      </span>
                    </div>
                  ))}
                  <span className="font-mono font-bold text-xs shrink-0 w-10 text-right">
                    {members.every(hasScore) ? (
                      combinedScore.toFixed(2)
                    ) : (
                      <span className="text-muted-foreground">—</span>
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
