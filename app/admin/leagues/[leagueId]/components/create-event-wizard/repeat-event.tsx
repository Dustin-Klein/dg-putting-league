'use client';

import { useState } from 'react';
import { useFormContext, useWatch } from 'react-hook-form';
import { Users } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils/utils';
import { formatDisplayDate, parseLocalDate } from '@/lib/utils/date-utils';
import {
  describeEventSetup,
  distanceLabel,
  formatMoney,
  teamFormatLabel,
  templateToSetupValues,
  type EventSetupContext,
  type EventSetupValues,
  type SetupEdit,
} from '@/lib/utils/event-setup';
import {
  AccessCodeField,
  AdminFeesField,
  BracketFramesField,
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
} from './fields';
import type { CreateEventField, CreateEventFormValues } from './schema';

export interface TemplateEvent extends EventSetupValues {
  id: string;
  event_date: string;
  location: string | null;
  participant_count: number;
}

export type StartChoice = 'template' | 'scratch';

function templateChips(template: TemplateEvent, ctx: EventSetupContext): string[] {
  const distance = distanceLabel(templateToSetupValues(template, ctx), ctx);
  return [
    teamFormatLabel(template.team_size, template.team_assignment),
    ...(template.qualification_round_enabled ? [`Qualification ${template.qualification_frame_count} frames`] : []),
    `Matches ${template.bracket_frame_count} frames`,
    `${template.lane_count} lane${template.lane_count === 1 ? '' : 's'}`,
    distance.charAt(0).toUpperCase() + distance.slice(1),
    ...(template.entry_fee_per_player ? [`${formatMoney(template.entry_fee_per_player)} entry`] : []),
  ];
}

export function StartScreen({
  ctx,
  template,
  dateSuggestions,
  choice,
  onChoiceChange,
  copyPlayers,
  onCopyPlayersChange,
}: {
  ctx: EventSetupContext;
  template: TemplateEvent;
  dateSuggestions: Date[];
  choice: StartChoice;
  onChoiceChange: (choice: StartChoice) => void;
  copyPlayers: boolean;
  onCopyPlayersChange: (copy: boolean) => void;
}) {
  const cardClass =
    'flex cursor-pointer gap-3 rounded-[14px] border-[1.5px] border-input bg-control p-4 transition-colors hover:border-foreground/40 ' +
    'has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50';
  // Not has-[:checked]: the template card also holds the copy-players checkbox.
  const selectedClass = 'border-foreground hover:border-foreground shadow-[inset_0_0_0_1px_var(--color-foreground)] bg-accent';
  return (
    <div className="flex flex-col gap-7">
      <Question title="Which night?">
        <EventDateField suggestions={dateSuggestions} />
        <LocationField />
      </Question>

      <Question title="Start from">
        <div role="radiogroup" aria-label="Start from" className="flex flex-col gap-2.5">
          <div className={cn(cardClass, 'flex-col', choice === 'template' && selectedClass)}>
            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="radio"
                name="start-from"
                checked={choice === 'template'}
                onChange={() => onChoiceChange('template')}
                className="mt-1 size-[18px] accent-foreground"
              />
              <span className="flex flex-col gap-0.5">
                <span className="text-base font-bold">Same as last event</span>
                <span className="text-[13px] text-muted-foreground">
                  {formatDisplayDate(parseLocalDate(template.event_date))}
                  {template.location ? ` · ${template.location}` : ''}
                </span>
              </span>
            </label>
            <ul aria-label="Last event's settings" className="flex flex-wrap gap-1.5 pl-[30px]">
              {templateChips(template, ctx).map((chip) => (
                <li key={chip} className="rounded-full bg-background px-2.5 py-1 text-[13px] font-semibold">{chip}</li>
              ))}
            </ul>
            {template.participant_count > 0 && (
              <label className="flex items-center gap-2.5 pl-[30px] text-sm font-semibold">
                <input
                  type="checkbox"
                  checked={copyPlayers}
                  disabled={choice !== 'template'}
                  onChange={(event) => onCopyPlayersChange(event.target.checked)}
                  className="size-[18px] accent-success"
                />
                Also add its {template.participant_count} player{template.participant_count === 1 ? '' : 's'}
              </label>
            )}
          </div>
          <label className={cn(cardClass, choice === 'scratch' && selectedClass)}>
            <input
              type="radio"
              name="start-from"
              checked={choice === 'scratch'}
              onChange={() => onChoiceChange('scratch')}
              className="mt-1 size-[18px] accent-foreground"
            />
            <span className="flex flex-col gap-0.5">
              <span className="text-base font-bold">Set up from scratch</span>
              <span className="text-[13px] text-muted-foreground">Walk through format, scoring and money one step at a time.</span>
            </span>
          </label>
        </div>
      </Question>
    </div>
  );
}

const EDIT_FIELDS: Record<SetupEdit, CreateEventField[]> = {
  team_size: ['team_size'],
  team_assignment: ['team_assignment'],
  qualification: ['qualification_round_enabled', 'qualification_frame_count'],
  bracket_frames: ['bracket_frame_count'],
  grand_final: ['double_grand_final'],
  lanes: ['lane_count'],
  distance: ['handicap_enabled', 'putt_distance_ft'],
  location: ['location'],
  entry_fee: ['entry_fee_per_player'],
  admin_fees: ['admin_fee_per_player', 'admin_fees'],
};

const EDIT_TITLES: Record<SetupEdit, string> = {
  team_size: 'Team size',
  team_assignment: 'How teams are formed',
  qualification: 'Qualification round',
  bracket_frames: 'Match length',
  grand_final: 'Grand final',
  lanes: 'Lanes',
  distance: 'Putt distance',
  location: 'Location',
  entry_fee: 'Entry fee',
  admin_fees: 'Admin fees',
};

function EditFields({ edit, ctx }: { edit: SetupEdit; ctx: EventSetupContext }) {
  switch (edit) {
    case 'team_size': return <TeamSizeField />;
    case 'team_assignment': return <TeamAssignmentField />;
    case 'qualification': return <QualificationField />;
    case 'bracket_frames': return <BracketFramesField />;
    case 'grand_final': return <GrandFinalField />;
    case 'lanes': return <LanesField />;
    case 'distance': return <DistanceField ctx={ctx} />;
    case 'location': return <LocationField />;
    case 'entry_fee': return <><EntryFeeField /><AdminFeesField /></>;
    case 'admin_fees': return <AdminFeesField />;
  }
}

function SentenceToken({ text, edit, ctx }: { text: string; edit: SetupEdit; ctx: EventSetupContext }) {
  const [open, setOpen] = useState(false);
  const { formState } = useFormContext<CreateEventFormValues>();
  const invalid = EDIT_FIELDS[edit].some((field) => formState.errors[field]);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`${EDIT_TITLES[edit]}: ${text}. Change`}
          className={cn(
            'rounded-sm border-b-2 border-dotted px-0.5 font-bold text-foreground hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-hidden',
            invalid ? 'border-destructive text-destructive' : 'border-info',
            open && 'bg-accent'
          )}
        >
          {text}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="flex w-[min(92vw,440px)] flex-col gap-3 rounded-[14px] p-4">
        <span className="text-xs font-bold tracking-[0.08em] text-muted-foreground uppercase">{EDIT_TITLES[edit]}</span>
        <EditFields edit={edit} ctx={ctx} />
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="h-10 rounded-lg bg-primary text-sm font-bold text-primary-foreground"
        >
          Done
        </button>
      </PopoverContent>
    </Popover>
  );
}

export function SentenceReview({
  ctx,
  template,
  copyPlayers,
  onRemovePlayers,
}: {
  ctx: EventSetupContext;
  template: TemplateEvent;
  copyPlayers: boolean;
  onRemovePlayers: () => void;
}) {
  const values = useWatch<CreateEventFormValues>() as CreateEventFormValues;
  const parts = describeEventSetup(values, ctx, values.location);
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 className="font-score text-[32px] leading-none font-bold">
          {values.event_date ? formatDisplayDate(values.event_date) : 'New event'}
        </h2>
        <p className="text-sm text-muted-foreground">
          Copied from {formatDisplayDate(parseLocalDate(template.event_date))} · tap anything underlined to change it
        </p>
      </div>
      <p className="text-xl leading-[1.75] text-muted-foreground sm:text-[22px]">
        {parts.map((part, index) =>
          part.edit
            ? <SentenceToken key={index} text={part.text} edit={part.edit} ctx={ctx} />
            : <span key={index}>{part.text}</span>
        )}
      </p>
      <div className="flex flex-col gap-2.5">
        {copyPlayers && (
          <div className="flex items-center justify-between gap-3 rounded-xl bg-muted py-2.5 pr-2 pl-4">
            <span className="flex items-center gap-2.5 text-[15px]">
              <Users className="size-[18px] text-muted-foreground" aria-hidden="true" />
              <span>
                <strong>{template.participant_count} player{template.participant_count === 1 ? '' : 's'}</strong> from{' '}
                {formatDisplayDate(parseLocalDate(template.event_date))}, payment not yet collected
              </span>
            </span>
            <button
              type="button"
              onClick={onRemovePlayers}
              className="h-9 rounded-lg px-3 text-sm font-semibold text-info hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-hidden"
            >
              Remove
            </button>
          </div>
        )}
        <AccessCodeField />
      </div>
    </div>
  );
}
