'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Check, Monitor } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { formatMoney } from '@/lib/utils/event-setup';
import { cn } from '@/lib/utils/utils';
import { KeptTeamsNotice } from '@/components/kept-teams-notice';
import { teamSizeShortfallMessage } from '@/lib/services/team/composition';
import type { EventWithDetails } from '@/lib/types/event';
import {
  formatMinutesAgo,
  paymentSplit,
  playersNotShown,
  readRosterShown,
  zoneCounts,
} from '@/lib/utils/roster-check';

type CheckState = 'ok' | 'warn';

function CheckRow({ state, title, children }: { state: CheckState; title: string; children?: React.ReactNode }) {
  return (
    <li className={cn('flex items-start gap-3 border-b px-3.5 py-3 last:border-b-0', state === 'warn' && 'bg-warning/10')}>
      <span
        className={cn(
          'mt-px inline-flex size-[22px] flex-none items-center justify-center rounded-full text-[13px] font-bold text-white',
          state === 'ok' ? 'bg-success' : 'bg-warning'
        )}
        aria-label={state === 'ok' ? 'OK' : 'Check'}
      >
        {state === 'ok' ? <Check className="size-3.5" strokeWidth={3} aria-hidden="true" /> : '!'}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-[15px] font-semibold">{title}</span>
        {children}
      </div>
    </li>
  );
}

/**
 * Last call before teams are drawn: the roster count against payments (the cash box and
 * payment app), when the roster was last on the TV and who registered since, and zones.
 */
export function RosterCheckStep({
  event,
  onContinue,
  onCancel,
}: {
  event: EventWithDetails;
  onContinue: () => void;
  onCancel: () => void;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const [now] = useState(() => Date.now());
  const shown = useMemo(() => readRosterShown(event.id), [event.id]);
  const players = event.players;
  const split = paymentSplit(players, event.entry_fee_per_player);
  const unseen = playersNotShown(players, shown);
  const shortfall = teamSizeShortfallMessage(players.length, event.team_size);
  const teams = Math.floor(players.length / event.team_size);
  const missingZone = event.handicap_enabled ? players.filter((p) => p.zone == null) : [];
  const zones = zoneCounts(players);

  const countTitle = [
    `${players.length} player${players.length === 1 ? '' : 's'}`,
    event.team_size > 1 && !shortfall ? `${teams} teams` : null,
    split.unpaid === 0 ? 'everyone marked paid' : `${split.unpaid} not marked paid`,
  ].filter(Boolean).join(' · ');

  return (
    <>
      <DialogHeader className="gap-1.5 px-5 pt-[22px] pb-4 pr-14 text-left sm:px-7">
        <DialogTitle className="text-[22px] font-bold">Close registration and start the bracket?</DialogTitle>
        <DialogDescription>
          Teams are drawn from the players below. Adding someone later means substituting them in, filling a bye or
          reopening registration.
        </DialogDescription>
      </DialogHeader>

      <div className="min-h-0 flex-1 overflow-auto px-5 pb-4 sm:px-7">
        <KeptTeamsNotice event={event} className="mb-3" />
        <ul className="m-0 flex list-none flex-col overflow-hidden rounded-xl border p-0">
          <CheckRow state={split.unpaid === 0 && !shortfall ? 'ok' : 'warn'} title={countTitle}>
            <span className="text-[13px] text-muted-foreground">
              {split.cash} cash{split.cashTotal != null && ` (${formatMoney(split.cashTotal)})`} · {split.electronic} electronic.
              {' '}Does that match the cash box and payment app?
            </span>
            {shortfall && <span className="text-[13px] font-medium text-warning">{shortfall}.</span>}
          </CheckRow>

          <CheckRow
            state={shown && unseen.length === 0 ? 'ok' : 'warn'}
            title={shown ? `Roster was last shown ${formatMinutesAgo(shown.at, now)}` : 'The roster has not been shown on screen'}
          >
            {shown && unseen.length > 0 && (
              <span className="text-[13px] leading-[1.45] text-muted-foreground">
                {unseen.length === 1 ? '1 player was' : `${unseen.length} players were`} added since then and
                {unseen.length === 1 ? " hasn't" : " haven't"} seen themselves on the screen:{' '}
                <strong className="text-foreground">{unseen.map((p) => p.player.full_name).join(', ')}</strong>.
              </span>
            )}
            {!shown && (
              <span className="text-[13px] text-muted-foreground">
                Put it on the TV so everyone can check their name{event.handicap_enabled ? ' and zone' : ''}.
              </span>
            )}
            {(!shown || unseen.length > 0) && (
              <span>
                <Button variant="outline" size="sm" asChild>
                  <Link href={`/admin/event/${event.id}/roster`}>
                    <Monitor className="mr-1.5 size-4" />
                    Show roster on screen
                  </Link>
                </Button>
              </span>
            )}
          </CheckRow>

          {event.handicap_enabled && (
            <CheckRow
              state={missingZone.length === 0 ? 'ok' : 'warn'}
              title={missingZone.length === 0 ? 'Every player has a zone' : `${missingZone.length} without a zone`}
            >
              <span className="text-[13px] text-muted-foreground">
                {missingZone.length > 0
                  ? missingZone.map((p) => p.player.full_name).join(', ')
                  : zones.map(({ zone, count }) => `Zone ${zone} · ${count}`).join('  ·  ')}
              </span>
            </CheckRow>
          )}
        </ul>

        <label className="mt-[18px] flex cursor-pointer items-start gap-2.5 text-sm leading-[1.45]">
          <input
            type="checkbox"
            className="mt-px size-5 flex-none accent-primary"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          <span>
            I called last call for registration and everyone has confirmed their name
            {event.handicap_enabled ? ' and zone' : ''}.
          </span>
        </label>
      </div>

      <DialogFooter className="flex-wrap gap-2.5 border-t px-5 py-[18px] sm:px-7">
        <Button variant="outline" onClick={onCancel} className="w-full sm:w-auto">
          Keep registration open
        </Button>
        <Button onClick={onContinue} disabled={!confirmed || shortfall !== null} className="w-full sm:w-auto">
          Preview teams
        </Button>
      </DialogFooter>
    </>
  );
}
