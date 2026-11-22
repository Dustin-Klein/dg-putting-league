'use client';

import { Users } from 'lucide-react';
import { cn } from '@/lib/utils/utils';
import type { EventWithDetails } from '@/lib/types/event';
import { keptTeamsStatus } from '@/lib/utils/roster-check';

function nameList(names: string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * Registration was reopened keeping the announced teams: say so, and who still needs a
 * team, wherever the organizer is about to start the bracket again.
 */
export function KeptTeamsNotice({ event, className }: { event: EventWithDetails; className?: string }) {
  if (!event.kept_teams || event.status !== 'pre-bracket') return null;
  const { keptCount, needTeam } = keptTeamsStatus(event.players, event.kept_teams);
  const names = needTeam.map((p) => p.player.full_name);
  const leftover = needTeam.length % event.team_size;
  const short = leftover === 0 ? 0 : event.team_size - leftover;

  return (
    <div
      role="status"
      className={cn('flex items-start gap-3 rounded-xl border border-info/40 bg-info/10 px-4 py-3', className)}
    >
      <Users className="mt-0.5 size-5 flex-none text-info" aria-hidden="true" />
      <div className="flex min-w-0 flex-col gap-1 text-sm leading-[1.45]">
        <span className="font-semibold">
          Registration reopened · keeping the {keptCount} team{keptCount === 1 ? '' : 's'} already announced
        </span>
        <span className="text-muted-foreground">
          {needTeam.length === 0
            ? 'Add the missed players. When you start the bracket they are paired with each other as new teams.'
            : `${nameList(names)} ${needTeam.length === 1 ? 'needs' : 'need'} a team. When you start the bracket, new players are paired with each other as new teams; nobody on a kept team changes partners.`}
        </span>
        {short > 0 && (
          <span className="font-medium text-warning">
            Add {short} more player{short === 1 ? '' : 's'} so the new players make full teams.
          </span>
        )}
      </div>
    </div>
  );
}
