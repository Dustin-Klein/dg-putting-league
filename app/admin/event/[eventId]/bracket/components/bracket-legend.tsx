import { Pencil } from 'lucide-react';
import { cn } from '@/lib/utils/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

const SWATCHES = [
  { label: 'Playing', className: 'border-success' },
  { label: 'Called to lane', className: 'border-warning' },
  { label: 'On deck', className: 'border-on-deck' },
  { label: 'Lane idle', className: 'border-destructive' },
  { label: 'Waiting', className: 'border-dashed border-input' },
];

function LiveDot() {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden="true" className="size-2 rounded-full bg-success" />
      Updates live
    </span>
  );
}

function Swatches({ showAdminEdits }: { showAdminEdits: boolean }) {
  return (
    <>
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
    </>
  );
}

/** Key for the match card borders under the bracket toolbar (BracketPage.dc.html). On phones the swatches sit behind a "Key" button. */
export function BracketLegend({ showAdminEdits = true, className }: { showAdminEdits?: boolean; className?: string }) {
  return (
    <div className={cn('flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px] text-muted-foreground', className)}>
      <LiveDot />
      <span className="contents max-md:hidden">
        <Swatches showAdminEdits={showAdminEdits} />
      </span>
      <Popover>
        <PopoverTrigger
          className="inline-flex h-9 items-center rounded-lg border-[1.5px] border-input px-3 text-sm font-semibold text-foreground transition-colors hover:bg-muted md:hidden"
        >
          Key
        </PopoverTrigger>
        <PopoverContent align="start" className="flex w-auto flex-col gap-2.5 text-[13px] text-muted-foreground">
          <Swatches showAdminEdits={showAdminEdits} />
        </PopoverContent>
      </Popover>
    </div>
  );
}
