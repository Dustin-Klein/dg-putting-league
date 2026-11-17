'use client';

import { useEffect, useRef } from 'react';
import { useFormContext, useWatch } from 'react-hook-form';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils/utils';
import { formatDisplayDate } from '@/lib/utils/date-utils';
import { setupFieldApplies, setupSummary, type EventSetupContext } from '@/lib/utils/event-setup';
import {
  AccessCodeField,
  AdminFeesField,
  BracketFramesField,
  CopyPlayersField,
  DistanceField,
  EntryFeeField,
  EventDateField,
  GrandFinalField,
  LanesField,
  LocationField,
  QualificationField,
  Question,
  TeamAssignmentField,
  TeamSizeField,
  type CopySource,
} from './fields';
import type { CreateEventField, CreateEventFormValues } from './schema';

export const STEPS = [
  { id: 'night', label: 'Night', heading: 'When and where?' },
  { id: 'format', label: 'Format', heading: 'How is the night played?' },
  { id: 'scoring', label: 'Scoring', heading: 'How long and how far?' },
  { id: 'money', label: 'Money', heading: 'Any fees?' },
  { id: 'review', label: 'Review', heading: 'Ready to create' },
] as const;

export type StepId = (typeof STEPS)[number]['id'];

/** The fields a step asks for, given the answers so far; Next validates only these. */
export function stepFields(step: StepId, values: CreateEventFormValues, ctx: EventSetupContext): CreateEventField[] {
  switch (step) {
    case 'night':
      return ['event_date', 'location', 'lane_count'];
    case 'format':
      return [
        'team_size',
        ...(setupFieldApplies('team_assignment', values) ? ['team_assignment' as const] : []),
        'qualification_round_enabled',
        ...(setupFieldApplies('qualification_frame_count', values) ? ['qualification_frame_count' as const] : []),
      ];
    case 'scoring':
      return [
        'bracket_frame_count',
        ...(ctx.leagueHandicaps ? ['handicap_enabled' as const] : []),
        ...(setupFieldApplies('putt_distance_ft', values) ? ['putt_distance_ft' as const] : []),
        'double_grand_final',
      ];
    case 'money':
      return ['entry_fee_per_player', 'admin_fee_per_player', 'admin_fees'];
    case 'review':
      return ['access_code'];
  }
}

/** The first step holding one of the given fields, so a failed submit can send the organizer there. */
export function firstStepWith(fields: CreateEventField[], values: CreateEventFormValues, ctx: EventSetupContext): number {
  const index = STEPS.findIndex((step) => stepFields(step.id, values, ctx).some((field) => fields.includes(field)));
  return index === -1 ? STEPS.length - 1 : index;
}

export function StepProgress({ current, onJump }: { current: number; onJump: (index: number) => void }) {
  return (
    <ol aria-label="Steps" className="grid grid-cols-5 gap-2 border-b px-5 py-3.5 sm:px-7">
      {STEPS.map((step, index) => {
        const done = index < current;
        const active = index === current;
        const content = (
          <>
            <span className={cn('h-1 rounded-full', done ? 'bg-success' : active ? 'bg-foreground' : 'bg-input')} aria-hidden="true" />
            <span className="flex items-center gap-1">
              {done && <Check className="size-3.5 text-success" aria-hidden="true" />}
              {step.label}
            </span>
          </>
        );
        return (
          <li key={step.id} aria-current={active ? 'step' : undefined} className="min-w-0">
            {done ? (
              <button
                type="button"
                onClick={() => onJump(index)}
                className="flex w-full flex-col gap-2 rounded-sm text-left text-[13px] font-semibold focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-hidden"
              >
                {content}
                <span className="sr-only"> (done, go back)</span>
              </button>
            ) : (
              <div className={cn('flex flex-col gap-2 text-[13px] font-semibold', active ? 'font-bold' : 'text-muted-foreground')}>
                {content}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function ReviewRow({ label, value, onEdit }: { label: string; value: string; onEdit: () => void }) {
  return (
    <div className="grid grid-cols-[84px_1fr_auto] items-center gap-3 border-b py-2.5 pr-1 pl-4 last:border-b-0 sm:grid-cols-[96px_1fr_auto]">
      <dt className="text-xs font-bold tracking-[0.08em] text-muted-foreground uppercase">{label}</dt>
      <dd className="m-0 text-[15px]">{value}</dd>
      <button
        type="button"
        onClick={onEdit}
        aria-label={`Edit ${label.toLowerCase()}`}
        className="h-9 rounded-lg px-3 text-sm font-semibold text-info hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-hidden"
      >
        Edit
      </button>
    </div>
  );
}

export function GuidedStep({
  step,
  ctx,
  copySources,
  copyFrom,
  onCopyFromChange,
  onJump,
}: {
  step: number;
  ctx: EventSetupContext;
  copySources: CopySource[];
  copyFrom: string;
  onCopyFromChange: (value: string) => void;
  onJump: (index: number) => void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const mounted = useRef(false);
  const { getValues } = useFormContext<CreateEventFormValues>();
  const values = useWatch<CreateEventFormValues>() as CreateEventFormValues;
  const { id, heading } = STEPS[step];

  useEffect(() => {
    if (mounted.current) headingRef.current?.focus();
    mounted.current = true;
  }, [step]);

  return (
    <div className="flex flex-col gap-6">
      <h2 ref={headingRef} tabIndex={-1} className="font-score text-[28px] leading-none font-bold outline-hidden">
        {heading}
      </h2>

      {id === 'night' && (
        <>
          <Question title="Date"><EventDateField /></Question>
          <LocationField />
          <LanesField />
        </>
      )}

      {id === 'format' && (
        <>
          <Question title="How do players enter the bracket?"><TeamSizeField /></Question>
          {setupFieldApplies('team_assignment', values) && (
            <Question title="How are teams formed?"><TeamAssignmentField /></Question>
          )}
          <Question title="Seed with a qualification round?"><QualificationField /></Question>
        </>
      )}

      {id === 'scoring' && (
        <>
          <Question title="How long is a bracket match?"><BracketFramesField /></Question>
          <Question title="How far do players putt?"><DistanceField ctx={ctx} /></Question>
          <Question title="Grand final"><GrandFinalField /></Question>
        </>
      )}

      {id === 'money' && (
        <>
          <EntryFeeField />
          <AdminFeesField />
        </>
      )}

      {id === 'review' && (() => {
        const summary = setupSummary(getValues(), ctx);
        const night = [
          values.event_date ? formatDisplayDate(values.event_date) : 'No date',
          values.location?.trim() || null,
          `${values.lane_count} lane${Number(values.lane_count) === 1 ? '' : 's'}`,
        ].filter(Boolean).join(' · ');
        return (
          <>
            <dl className="m-0 rounded-xl border">
              <ReviewRow label="Night" value={night} onEdit={() => onJump(0)} />
              <ReviewRow label="Format" value={summary.format} onEdit={() => onJump(1)} />
              <ReviewRow label="Scoring" value={summary.scoring} onEdit={() => onJump(2)} />
              <ReviewRow label="Money" value={summary.money} onEdit={() => onJump(3)} />
            </dl>
            <CopyPlayersField sources={copySources} value={copyFrom} onChange={onCopyFromChange} />
            <AccessCodeField />
          </>
        );
      })()}
    </div>
  );
}
