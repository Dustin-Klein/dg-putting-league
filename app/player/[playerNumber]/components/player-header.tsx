'use client';

import { Badge } from '@/components/ui/badge';
import type { Player } from '@/lib/types/player';

interface PlayerHeaderProps {
  player: Player;
}

export function PlayerHeader({ player }: PlayerHeaderProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <h1 className="text-3xl font-bold">{player.full_name}</h1>
        {player.player_number && (
          <Badge variant="secondary" className="text-lg px-3 py-1">
            #{player.player_number}
          </Badge>
        )}
      </div>

      <div className="flex items-center gap-4 text-muted-foreground">
        {player.nickname && (
          <span>&quot;{player.nickname}&quot;</span>
        )}
        {player.default_pool && (
          <Badge variant="outline">
            Default Pool: {player.default_pool}
          </Badge>
        )}
      </div>
    </div>
  );
}
