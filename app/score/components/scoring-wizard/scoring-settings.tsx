'use client';

import { Minus, Plus, Settings, Smartphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils/utils';
import { useScoringMode } from './use-scoring-mode';

const MINI = 'flex size-[30px] items-center justify-center rounded-lg border-[1.5px] border-input bg-control font-score text-[17px] font-bold';

/** Gear on the scoreboard band (dark scope) that opens the scoring settings sheet. */
export function ScoringSettingsButton({ className }: { className?: string }) {
  const [mode, setMode] = useScoringMode();
  const david = mode === 'david';

  return (
    <Dialog>
      <DialogTrigger
        aria-label={david ? 'Scoring settings, David scoring on' : 'Scoring settings'}
        className={cn(
          'relative -mr-2 inline-flex size-11 shrink-0 items-center justify-center rounded-[10px] text-foreground outline-none hover:bg-foreground/10 focus-visible:ring-[3px] focus-visible:ring-ring/50',
          className
        )}
      >
        <Settings className="size-5" aria-hidden="true" />
        {david && (
          <span aria-hidden="true" className="absolute top-2 right-2 size-2 rounded-full bg-success ring-2 ring-board" />
        )}
      </DialogTrigger>
      <DialogContent
        showCloseButton
        className="top-auto bottom-0 left-0 max-w-none translate-x-0 translate-y-0 gap-4 rounded-t-[20px] rounded-b-none border-x-0 border-b-0 px-4 pt-5 pb-[22px] data-[state=closed]:zoom-out-100 data-[state=open]:zoom-in-100 data-[state=open]:slide-in-from-bottom-8 sm:left-1/2 sm:max-w-lg sm:-translate-x-1/2"
      >
        <DialogTitle className="font-score text-[26px] leading-none font-bold">Scoring settings</DialogTitle>

        <div className="flex flex-col gap-3.5 rounded-2xl border p-3.5">
          <div className="flex items-start gap-3">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <label htmlFor="david-scoring" className="text-base font-bold">
                David scoring
              </label>
              <DialogDescription className="text-[13px] leading-snug">
                Count each putt with − and + instead of tapping 0–3 once.
              </DialogDescription>
            </div>
            <Switch
              id="david-scoring"
              checked={david}
              onCheckedChange={(checked) => setMode(checked ? 'david' : 'tap')}
              className="h-8 w-[52px] data-[state=checked]:bg-success [&>span]:size-[26px] [&>span]:data-[state=checked]:translate-x-[22px] [&>span]:data-[state=unchecked]:translate-x-0.5"
            />
          </div>

          <div aria-hidden="true" className="grid grid-cols-2 gap-2">
            <div
              className={cn(
                'flex flex-col items-center gap-2 rounded-xl border-2 bg-background p-2.5',
                david ? 'border-transparent opacity-60' : 'border-foreground'
              )}
            >
              <div className="flex gap-1">
                <span className={MINI}>0</span>
                <span className={MINI}>1</span>
                <span className={cn(MINI, 'border-team-1 bg-team-1 text-white')}>2</span>
                <span className={MINI}>3</span>
              </div>
              <span className="text-xs font-semibold">
                One tap <span className="font-medium text-muted-foreground">· default</span>
              </span>
            </div>
            <div
              className={cn(
                'flex flex-col items-center gap-2 rounded-xl border-2 bg-background p-2.5',
                david ? 'border-foreground' : 'border-transparent opacity-60'
              )}
            >
              <div className="flex items-center gap-1">
                <span className={cn(MINI, 'rounded-full')}>
                  <Minus className="size-3.5" strokeWidth={2.5} />
                </span>
                <span className={cn(MINI, 'w-9 border-2 border-team-1 text-team-1-ink')}>2</span>
                <span className={cn(MINI, 'rounded-full')}>
                  <Plus className="size-3.5" strokeWidth={2.5} />
                </span>
              </div>
              <span className="text-xs font-semibold">David scoring</span>
            </div>
          </div>
        </div>

        <p className="flex items-start gap-1.5 text-xs leading-normal text-muted-foreground">
          <Smartphone className="mt-px size-3.5 shrink-0" aria-hidden="true" />
          Saved on this device. Applies to match and qualification scoring. Scores already entered are kept.
        </p>

        <DialogClose asChild>
          <Button className="h-[54px] rounded-[14px] text-base">Done</Button>
        </DialogClose>
      </DialogContent>
    </Dialog>
  );
}
