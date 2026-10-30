'use client';

import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { PoolBadge } from '@/components/pool-badge';
import type { Player } from '@/lib/types/player';
import type { PlayerOngoingEvent } from '@/lib/types/player-statistics';

interface PlayerHeaderProps {
  player: Player;
  ongoingEvents?: PlayerOngoingEvent[];
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

/** Scoreboard band at the top of a player's page; dark in both themes. */
export function PlayerHeader({ player, ongoingEvents = [] }: PlayerHeaderProps) {
  const live = ongoingEvents.find((event) => event.eventStatus === 'bracket');

  return (
    <header className="bg-board border-b border-board dark:border-border">
      <div className="dark text-foreground mx-auto flex max-w-[1200px] flex-col gap-[18px] px-4 pt-5 pb-8 md:px-6">
        <Link
          href="/players"
          className="inline-flex min-h-8 w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
          Back to Players
        </Link>
        <div className="flex flex-wrap items-center gap-5">
          <span
            aria-hidden="true"
            className="flex size-20 shrink-0 items-center justify-center rounded-full border border-input bg-control font-score text-[34px] font-bold"
          >
            {initials(player.full_name)}
          </span>
          <div className="flex min-w-0 flex-col gap-2">
            <h1 className="font-score text-[52px] leading-[0.95] font-bold">{player.full_name}</h1>
            <div className="flex flex-wrap items-center gap-2.5 text-sm text-muted-foreground">
              {player.player_number && <span>Player #{player.player_number}</span>}
              {player.nickname && <span>&quot;{player.nickname}&quot;</span>}
              {player.default_pool && (
                <span className="inline-flex items-center gap-1.5">
                  Default Pool <PoolBadge pool={player.default_pool} />
                </span>
              )}
            </div>
          </div>
          {live && (
            <Link
              href={`/event/${live.eventId}/bracket`}
              className="flex items-center gap-3 rounded-[14px] border border-success bg-success/10 px-4 py-3 md:ml-auto"
            >
              <span aria-hidden="true" className="size-2.5 rounded-full bg-success" />
              <span className="flex flex-col">
                <span className="text-[13px] font-bold text-success">Playing now</span>
                <span className="text-sm">
                  {live.leagueName}
                  {live.teammateName && ` with ${live.teammateName}`}
                </span>
              </span>
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
