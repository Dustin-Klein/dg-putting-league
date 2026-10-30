import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils/utils';

/**
 * The A/B marker shown next to a player: Pool A filled, Pool B outlined (pools are
 * neutral, not colored). Renders nothing for events that did not draw from pools
 * (singles, flat random draws, manual teams).
 */
export function PoolBadge({ pool, className }: { pool: 'A' | 'B' | null | undefined; className?: string }) {
  if (!pool) return null;
  return (
    <Badge
      className={cn(
        pool === 'B' && 'border-foreground bg-transparent text-foreground hover:bg-transparent',
        className
      )}
    >
      {pool}
    </Badge>
  );
}
