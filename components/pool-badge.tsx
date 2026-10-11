import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils/utils';

/**
 * The A/B marker shown next to a player. Renders nothing for events that did not
 * draw from pools (singles, flat random draws, manual teams).
 */
export function PoolBadge({ pool, className }: { pool: 'A' | 'B' | null | undefined; className?: string }) {
  if (!pool) return null;
  return (
    <Badge className={cn(pool === 'B' && 'bg-blue-500 hover:bg-blue-600', className)}>
      {pool}
    </Badge>
  );
}
