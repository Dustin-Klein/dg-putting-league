'use client';

import Link from 'next/link';
import { Check, Lock, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils/utils';
import { NextStatusButton } from '@/components/next-status-button';
import { formatDisplayDate } from '@/lib/utils/date-utils';
import type { EventStatus, EventWithDetails } from '@/lib/types/event';
import { describeTeamFormat } from '@/lib/utils/team-utils';
import { ZoneDistancesPopover, useEventHandicap, zoneLadderText } from './event-handicap';

const STEPS: { status: EventStatus; label: string }[] = [
  { status: 'created', label: 'Created' },
  { status: 'pre-bracket', label: 'Pre-Bracket' },
  { status: 'bracket', label: 'Bracket' },
  { status: 'completed', label: 'Completed' },
];

function StatusSteps({ status }: { status: EventStatus }) {
  const currentIndex = STEPS.findIndex((step) => step.status === status);
  return (
    <ol aria-label="Event status" className="flex flex-wrap items-center gap-1 text-[13px] font-semibold">
      {STEPS.map((step, index) => {
        const done = index < currentIndex;
        const current = index === currentIndex;
        return (
          <li
            key={step.status}
            aria-current={current ? 'step' : undefined}
            className={cn(
              'inline-flex items-center gap-1 rounded-full px-2.5 py-1',
              current && 'bg-foreground text-background',
              done && 'text-foreground',
              !done && !current && 'text-muted-foreground'
            )}
          >
            {done && <Check className="size-3.5" aria-hidden="true" />}
            {step.label}
          </li>
        );
      })}
    </ol>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 rounded-[14px] border bg-card p-4">
      <span className="text-[13px] font-semibold text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

export function EventHeader({ event, onStatusUpdate }: { event: EventWithDetails; onStatusUpdate?: () => void }) {
  // Use the event prop directly since state is now managed by parent
  const players = Array.isArray(event.players) ? event.players : [];
  const entryFee = event.entry_fee_per_player != null ? Number(event.entry_fee_per_player) : null;
  const handicapView = useEventHandicap()?.view;
  const ladder = zoneLadderText(handicapView);
  const ladderEditable = handicapView?.editable ?? false;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <h1 className="font-score text-5xl leading-none font-bold">
            {formatDisplayDate(event.event_date)}
          </h1>
          <p className="text-[15px] text-muted-foreground">
            {event.location || 'Location not specified'}
            {(event.status === 'bracket' || event.status === 'completed') && (
              <>
                {' · '}
                <Link href={`/event/${event.id}/bracket`} className="text-info hover:underline">
                  Public bracket page
                </Link>
              </>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <StatusSteps status={event.status} />
          <NextStatusButton
            event={event}
            onStatusUpdate={onStatusUpdate}
          />
        </div>
      </div>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-3">
        {event.access_code && (
          <Stat label="Access Code">
            <div className="flex items-center gap-1">
              <code className="font-score text-[28px] leading-none font-bold tracking-[0.08em]">
                {event.access_code}
              </code>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  if (event.access_code) {
                    navigator.clipboard.writeText(event.access_code);
                  }
                }}
              >
                Copy
              </Button>
            </div>
          </Stat>
        )}

        {ladder ? (
          <ZoneDistancesPopover>
            <button
              type="button"
              className="flex flex-col gap-1 rounded-[14px] border bg-card p-4 text-left hover:border-foreground/40"
              aria-label={`Putt distance by zone: ${ladder} feet. ${ladderEditable ? 'Edit' : 'View'} tonight's zone distances`}
            >
              <span className="flex items-center justify-between gap-2 text-[13px] font-semibold text-muted-foreground">
                Putt Distance
                {ladderEditable
                  ? <Pencil className="size-3.5" aria-hidden="true" />
                  : <Lock className="size-3.5" aria-hidden="true" />}
              </span>
              <span className="font-score text-[28px] leading-none font-bold tabular-nums">{ladder}</span>
              <span className="text-xs text-muted-foreground">ft by handicap zone</span>
            </button>
          </ZoneDistancesPopover>
        ) : (
          <Stat label="Putt Distance">
            <span className="font-score text-[28px] leading-none font-bold">
              {event.handicap_enabled ? 'By zone' : `${event.putt_distance_ft} ft`}
            </span>
            {event.handicap_enabled && <span className="text-xs text-muted-foreground">By handicap zone</span>}
          </Stat>
        )}

        <Stat label="Lanes">
          <span className="font-score text-[28px] leading-none font-bold tabular-nums">{event.lane_count}</span>
        </Stat>

        <Stat label="Participants">
          <span className="font-score text-[28px] leading-none font-bold tabular-nums">
            {players.filter(p => p.payment_type !== null).length}/{players.length}
          </span>
          <span className="text-xs text-muted-foreground">paid</span>
        </Stat>

        {entryFee !== null && (
          <Stat label="Entry Fee">
            <span className="font-score text-[28px] leading-none font-bold tabular-nums">${entryFee.toFixed(2)}</span>
            <span className="text-xs text-muted-foreground">
              Cash ${(players.filter(p => p.payment_type === 'cash').length * entryFee).toFixed(2)} · Electronic $
              {(players.filter(p => p.payment_type === 'electronic').length * entryFee).toFixed(2)}
            </span>
          </Stat>
        )}

        <Stat label="Teams">
          <span className="text-base font-bold">{describeTeamFormat(event.team_size, event.team_assignment)}</span>
        </Stat>

        <Stat label="Bonus Points">
          <span className="text-base font-bold">{event.bonus_point_enabled ? 'Enabled' : 'Disabled'}</span>
        </Stat>

        <Stat label="Qualification Round">
          <span className="text-base font-bold">{event.qualification_round_enabled ? 'Enabled' : 'Disabled'}</span>
        </Stat>
      </div>
    </div>
  );
}
