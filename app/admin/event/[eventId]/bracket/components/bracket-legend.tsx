import { Pencil } from 'lucide-react';
import { cn } from '@/lib/utils/utils';

const SWATCHES = [
  { label: 'Playing', className: 'border-success' },
  { label: 'Called to lane', className: 'border-warning' },
  { label: 'On deck', className: 'border-on-deck' },
  { label: 'Lane idle', className: 'border-destructive' },
  { label: 'Waiting', className: 'border-dashed border-input' },
];

/** Key for the match card borders under the bracket toolbar (BracketPage.dc.html). */
export function BracketLegend({ showAdminEdits = true }: { showAdminEdits?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px] text-muted-foreground">
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden="true" className="size-2 rounded-full bg-success" />
        Updates live
      </span>
      {SWATCHES.map((swatch) => (
        <span key={swatch.label} className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className={cn('h-3.5 w-[22px] rounded border-2', swatch.className)} />
          {swatch.label}
        </span>
      ))}
      {showAdminEdits && (
        <span className="inline-flex items-center gap-1.5">
          <Pencil className="size-[13px] text-warning" aria-hidden="true" />
          Completed · click to correct the score
        </span>
      )}
    </div>
  );
}
