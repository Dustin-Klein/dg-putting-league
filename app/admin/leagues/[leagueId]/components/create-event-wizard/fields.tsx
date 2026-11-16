'use client';

import { useId, useState } from 'react';
import { useController, useFormContext, useWatch } from 'react-hook-form';
import { CalendarIcon, Minus, Plus, RefreshCw, Ruler } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils/utils';
import { formatDisplayDate, isFutureOrToday } from '@/lib/utils/date-utils';
import { TEAM_SIZE_MAX, TEAM_SIZE_MIN } from '@/lib/types/event';
import { teamAssignmentOptions } from '@/lib/utils/team-utils';
import { generateAccessCode, teamSizeLabel, type EventSetupContext } from '@/lib/utils/event-setup';
import { zoneColorClass } from '@/components/zone-badge';
import type { CreateEventField, CreateEventFormValues } from './schema';

function FieldError({ name }: { name: CreateEventField }) {
  const { formState } = useFormContext<CreateEventFormValues>();
  const message = formState.errors[name]?.message;
  if (!message) return null;
  return <p role="alert" className="text-sm font-medium text-destructive">{String(message)}</p>;
}

export function Question({ title, children, id }: { title: string; children: React.ReactNode; id?: string }) {
  const generated = useId();
  const headingId = id ?? generated;
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2.5">
      <h3 id={headingId} className="text-[17px] font-bold">{title}</h3>
      {children}
    </section>
  );
}

const choiceClass =
  'flex cursor-pointer rounded-xl border-[1.5px] border-input bg-control transition-colors hover:border-foreground/40 ' +
  'has-[:checked]:border-foreground has-[:checked]:shadow-[inset_0_0_0_1px_var(--color-foreground)] has-[:checked]:bg-accent ' +
  'has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50';

/** A radio styled as a card; native radios keep arrow-key navigation within the group. */
function ChoiceCard({
  name,
  checked,
  onSelect,
  title,
  description,
  glyph,
  className,
}: {
  name: string;
  checked: boolean;
  onSelect: () => void;
  title: string;
  description?: string;
  glyph?: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={cn(choiceClass, 'flex-col gap-1 px-4 py-3', className)}>
      <input type="radio" name={name} checked={checked} onChange={onSelect} className="sr-only" />
      {glyph}
      <span className="text-[15px] font-bold">{title}</span>
      {description && <span className="text-[13px] text-muted-foreground">{description}</span>}
    </label>
  );
}

export function Stepper({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max?: number;
  onChange: (value: number) => void;
}) {
  const safe = Number.isFinite(value) ? value : min;
  return (
    <div role="group" aria-label={label} className="flex items-center gap-1.5">
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label={`Fewer ${label.toLowerCase()}`}
        disabled={safe <= min}
        onClick={() => onChange(Math.max(min, safe - 1))}
      >
        <Minus aria-hidden="true" />
      </Button>
      <output aria-live="polite" className="w-10 text-center font-score text-[28px] leading-none font-bold tabular-nums">
        {safe}
      </output>
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label={`More ${label.toLowerCase()}`}
        disabled={max !== undefined && safe >= max}
        onClick={() => onChange(max !== undefined ? Math.min(max, safe + 1) : safe + 1)}
      >
        <Plus aria-hidden="true" />
      </Button>
    </div>
  );
}

function SettingRow({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl bg-muted py-2.5 pr-2.5 pl-4">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-[15px] font-semibold">{title}</span>
        {description && <span className="text-[13px] text-muted-foreground">{description}</span>}
      </div>
      {children}
    </div>
  );
}

function StepperRow({
  name,
  title,
  description,
  min,
  max,
}: {
  name: 'lane_count' | 'bracket_frame_count' | 'qualification_frame_count';
  title: string;
  description?: string;
  min: number;
  max?: number;
}) {
  const { field } = useController<CreateEventFormValues, typeof name>({ name });
  return (
    <>
      <SettingRow title={title} description={description}>
        <Stepper label={title} value={Number(field.value)} min={min} max={max} onChange={field.onChange} />
      </SettingRow>
      <FieldError name={name} />
    </>
  );
}

export function EventDateField({ suggestions = [] }: { suggestions?: Date[] }) {
  const { field } = useController<CreateEventFormValues, 'event_date'>({ name: 'event_date' });
  const [open, setOpen] = useState(false);
  const selected = field.value as Date | undefined;
  const sameDay = (a?: Date, b?: Date) => !!a && !!b && a.toDateString() === b.toDateString();
  const otherSelected = !!selected && !suggestions.some((date) => sameDay(date, selected));

  const picker = (
    <PopoverContent className="w-auto p-0" align="start">
      <Calendar
        mode="single"
        selected={selected}
        onSelect={(date) => {
          field.onChange(date);
          setOpen(false);
        }}
        disabled={(date) => !isFutureOrToday(date)}
        autoFocus
      />
    </PopoverContent>
  );

  if (suggestions.length === 0) {
    return (
      <div className="flex flex-col gap-1.5">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              aria-label={selected ? `Event date, ${formatDisplayDate(selected)}` : 'Pick the event date'}
              className={cn('w-full justify-start pl-3 font-normal', !selected && 'text-muted-foreground')}
            >
              {selected ? formatDisplayDate(selected) : 'Pick a date'}
              <CalendarIcon className="ml-auto opacity-50" aria-hidden="true" />
            </Button>
          </PopoverTrigger>
          {picker}
        </Popover>
        <FieldError name="event_date" />
      </div>
    );
  }

  const dateCard =
    'flex min-h-[60px] cursor-pointer flex-col items-start justify-center rounded-xl border-[1.5px] border-input bg-control px-4 transition-colors hover:border-foreground/40 ' +
    'has-[:checked]:border-foreground has-[:checked]:bg-foreground has-[:checked]:text-background has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50';
  const options = otherSelected ? [...suggestions, selected!] : suggestions;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap gap-2">
        <div role="radiogroup" aria-label="Event date" className="flex flex-wrap gap-2">
          {options.map((date, index) => (
            <label key={date.toISOString()} className={cn(dateCard, 'group')}>
              <input
                type="radio"
                name="event-date"
                checked={sameDay(date, selected)}
                onChange={() => field.onChange(date)}
                className="sr-only"
              />
              <span className="font-score text-2xl leading-tight font-bold">
                {date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
              </span>
              <span className="text-xs font-semibold text-muted-foreground group-has-[:checked]:text-background/75">
                {index === 0 ? 'Next one' : index === 1 && index < suggestions.length ? 'The week after' : 'Picked date'}
              </span>
            </label>
          ))}
        </div>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="flex min-h-[60px] items-center gap-2 rounded-xl border-[1.5px] border-dashed border-input px-4 text-[15px] font-semibold transition-colors hover:border-foreground/40 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-hidden"
            >
              <CalendarIcon className="size-[18px]" aria-hidden="true" />
              Other date
            </button>
          </PopoverTrigger>
          {picker}
        </Popover>
      </div>
      <FieldError name="event_date" />
    </div>
  );
}

export function LocationField() {
  const { register } = useFormContext<CreateEventFormValues>();
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-semibold">Location <span className="font-normal text-muted-foreground">(optional)</span></label>
      <Input id={id} placeholder="e.g., Central Park" {...register('location')} />
      <FieldError name="location" />
    </div>
  );
}

export function LanesField() {
  return <StepperRow name="lane_count" title="Lanes" description="Matches running at the same time" min={1} />;
}

function TeamDots({ size }: { size: number }) {
  return (
    <span className="flex gap-1" aria-hidden="true">
      {Array.from({ length: size }, (_, index) => (
        <span
          key={index}
          className={cn('size-2.5 rounded-full', size === 2 ? (index === 0 ? 'bg-team-1' : 'bg-team-2') : 'bg-muted-foreground')}
        />
      ))}
    </span>
  );
}

export function TeamSizeField() {
  const { setValue, getValues } = useFormContext<CreateEventFormValues>();
  const { field } = useController<CreateEventFormValues, 'team_size'>({ name: 'team_size' });
  const sizes = Array.from({ length: TEAM_SIZE_MAX - TEAM_SIZE_MIN + 1 }, (_, index) => TEAM_SIZE_MIN + index);
  return (
    <div role="radiogroup" aria-label="Team size" className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
      {sizes.map((size) => (
        <ChoiceCard
          key={size}
          name="team_size"
          checked={Number(field.value) === size}
          onSelect={() => {
            field.onChange(size);
            const options = teamAssignmentOptions(size);
            if (!options.some((option) => option.value === getValues('team_assignment'))) {
              setValue('team_assignment', options[0].value);
            }
          }}
          title={teamSizeLabel(size)}
          glyph={<span className="mb-1.5"><TeamDots size={size} /></span>}
          className="p-3.5"
        />
      ))}
    </div>
  );
}

export function TeamAssignmentField() {
  const teamSize = Number(useWatch<CreateEventFormValues, 'team_size'>({ name: 'team_size' }));
  const { field } = useController<CreateEventFormValues, 'team_assignment'>({ name: 'team_assignment' });
  return (
    <div role="radiogroup" aria-label="How teams are formed" className="flex flex-col gap-2">
      {teamAssignmentOptions(teamSize).map((option) => (
        <ChoiceCard
          key={option.value}
          name="team_assignment"
          checked={field.value === option.value}
          onSelect={() => field.onChange(option.value)}
          title={option.label}
          description={option.description}
        />
      ))}
      <FieldError name="team_assignment" />
    </div>
  );
}

export function QualificationField() {
  const { field } = useController<CreateEventFormValues, 'qualification_round_enabled'>({ name: 'qualification_round_enabled' });
  return (
    <div className="flex flex-col gap-2.5">
      <div role="radiogroup" aria-label="Qualification round" className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        <ChoiceCard
          name="qualification_round_enabled"
          checked={field.value === true}
          onSelect={() => field.onChange(true)}
          title="Yes"
          description="Everyone putts first; scores set seeds and pools."
        />
        <ChoiceCard
          name="qualification_round_enabled"
          checked={field.value === false}
          onSelect={() => field.onChange(false)}
          title="No"
          description="Seed from each player's past average."
        />
      </div>
      {field.value && <StepperRow name="qualification_frame_count" title="Qualification frames" min={1} max={10} />}
    </div>
  );
}

export function BracketFramesField() {
  return (
    <StepperRow
      name="bracket_frame_count"
      title="Frames per match"
      description="3 putts each per frame · sudden death if tied"
      min={1}
      max={10}
    />
  );
}

export function ZoneLadder({ zones }: { zones: EventSetupContext['zones'] }) {
  return (
    <ul aria-label="Zone distances" className="grid grid-cols-1 gap-2 sm:grid-cols-3">
      {[...zones].sort((a, b) => a.zone - b.zone).map((zone) => (
        <li key={zone.zone} className="flex items-center justify-between rounded-lg bg-background px-3 py-2.5">
          <span className={cn('rounded-md px-2 py-0.5 text-xs font-bold', zoneColorClass(zone.zone))}>Zone {zone.zone}</span>
          <span className="font-score text-[26px] leading-none font-bold">{zone.distance_ft} ft</span>
        </li>
      ))}
    </ul>
  );
}

export function DistanceField({ ctx }: { ctx: EventSetupContext }) {
  const { register } = useFormContext<CreateEventFormValues>();
  const id = useId();
  if (ctx.handicapEnabled) {
    return (
      <div className="flex flex-col gap-3.5 rounded-xl border-[1.5px] border-input bg-muted p-4">
        <div className="flex items-start gap-3">
          <Ruler className="mt-0.5 size-5 shrink-0 text-info" aria-hidden="true" />
          <div className="flex flex-col gap-0.5">
            <span className="text-[15px] font-bold">From their handicap zone</span>
            <span className="text-[13px] text-muted-foreground">
              This league uses distance handicaps, so there&apos;s no single event distance. You can adjust tonight&apos;s
              distances on the event page until the first frame is scored.
            </span>
          </div>
        </div>
        <ZoneLadder zones={ctx.zones} />
      </div>
    );
  }
  return (
    <>
      <SettingRow title="Putt distance" description="Same line on every lane">
        <span className="flex items-center gap-2">
          <Input
            id={id}
            type="number"
            step="0.5"
            min="1"
            aria-label="Putt distance in feet"
            className="w-24 text-center font-score text-2xl font-bold md:text-2xl"
            {...register('putt_distance_ft')}
          />
          <span className="text-[15px] text-muted-foreground">ft</span>
        </span>
      </SettingRow>
      <FieldError name="putt_distance_ft" />
    </>
  );
}

export function GrandFinalField() {
  const { field } = useController<CreateEventFormValues, 'double_grand_final'>({ name: 'double_grand_final' });
  const id = useId();
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl bg-muted px-4 py-3">
      <label htmlFor={id} className="flex flex-col gap-0.5">
        <span className="text-[15px] font-semibold">Bracket reset</span>
        <span className="text-[13px] text-muted-foreground">If the losers-bracket team wins the final, play one more.</span>
      </label>
      <Switch id={id} checked={field.value} onCheckedChange={field.onChange} className="data-[state=checked]:bg-success" />
    </div>
  );
}

function MoneyInput({ name, label }: { name: 'entry_fee_per_player' | 'admin_fees' | 'admin_fee_per_player'; label: string }) {
  const { field: { ref, ...field } } = useController<CreateEventFormValues, typeof name>({ name });
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-semibold">{label}</label>
      <div className="relative">
        <span className="absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted-foreground" aria-hidden="true">$</span>
        <Input
          id={id}
          type="number"
          step="0.01"
          min="0"
          placeholder="0.00"
          name={field.name}
          ref={ref}
          onBlur={field.onBlur}
          value={field.value ?? ''}
          onChange={(event) => field.onChange(event.target.value === '' ? null : Number(event.target.value))}
          className="pl-7"
        />
      </div>
      <FieldError name={name} />
    </div>
  );
}

export function EntryFeeField() {
  return <MoneyInput name="entry_fee_per_player" label="Entry fee per player" />;
}

export function AdminFeesField() {
  const { setValue, getValues } = useFormContext<CreateEventFormValues>();
  const [open, setOpen] = useState(() => getValues('admin_fees') != null || getValues('admin_fee_per_player') != null);
  const id = useId();
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-4 rounded-xl bg-muted px-4 py-3">
        <label htmlFor={id} className="flex flex-col gap-0.5">
          <span className="text-[15px] font-semibold">Admin fees</span>
          <span className="text-[13px] text-muted-foreground">Money kept out of the payout pool</span>
        </label>
        <Switch
          id={id}
          checked={open}
          onCheckedChange={(next) => {
            setOpen(next);
            if (!next) {
              setValue('admin_fees', null);
              setValue('admin_fee_per_player', null);
            }
          }}
          className="data-[state=checked]:bg-success"
        />
      </div>
      {open && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <MoneyInput name="admin_fee_per_player" label="Per player" />
          <MoneyInput name="admin_fees" label="Per event" />
        </div>
      )}
    </div>
  );
}

export function AccessCodeField() {
  const { register, setValue } = useFormContext<CreateEventFormValues>();
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5 rounded-[14px] bg-background px-4 py-3.5">
      <label htmlFor={id} className="text-xs font-bold tracking-[0.08em] text-muted-foreground uppercase">Scoring code</label>
      <div className="flex items-center gap-3">
        <Input
          id={id}
          {...register('access_code')}
          autoCapitalize="characters"
          spellCheck={false}
          className="h-auto flex-1 border-transparent bg-transparent px-0 font-score text-[40px] leading-none md:text-[40px] font-bold tracking-[0.12em] uppercase focus-visible:border-transparent focus-visible:ring-0"
        />
        <Button type="button" variant="outline" onClick={() => setValue('access_code', generateAccessCode(), { shouldValidate: true })}>
          <RefreshCw aria-hidden="true" />
          New code
        </Button>
      </div>
      <p className="text-[13px] text-muted-foreground">Players type this at /score.</p>
      <FieldError name="access_code" />
    </div>
  );
}

export interface CopySource {
  id: string;
  label: string;
}

export function CopyPlayersField({
  sources,
  value,
  onChange,
}: {
  sources: CopySource[];
  value: string;
  onChange: (value: string) => void;
}) {
  const id = useId();
  if (sources.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[15px] font-semibold">Start with players from</label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-11 w-full rounded-lg border-[1.5px] border-input bg-control px-3 text-base md:text-[15px]"
      >
        <option value="">Nobody yet</option>
        {sources.map((source) => (
          <option key={source.id} value={source.id}>{source.label}</option>
        ))}
      </select>
    </div>
  );
}
