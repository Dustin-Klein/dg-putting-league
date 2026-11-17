'use client';

import { useMemo, useState } from 'react';
import { useForm, type FieldErrors } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Form } from '@/components/ui/form';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { formatDisplayDate, parseLocalDate } from '@/lib/utils/date-utils';
import {
  defaultEventSetup,
  generateAccessCode,
  templateToSetupValues,
  toCreateEventBody,
  upcomingWeekdayDates,
  type EventSetupContext,
} from '@/lib/utils/event-setup';
import { createEventSchema, type CreateEventField, type CreateEventFormValues } from './create-event-wizard/schema';
import { GuidedStep, STEPS, StepProgress, firstStepWith, stepFields } from './create-event-wizard/guided-steps';
import { SentenceReview, StartScreen, type StartChoice, type TemplateEvent } from './create-event-wizard/repeat-event';
import type { CopySource } from './create-event-wizard/fields';

export interface CompletedEventOption {
  id: string;
  event_date: string;
  location: string | null;
  participant_count?: number;
}

interface CreateEventDialogProps {
  leagueId: string;
  leagueName?: string;
  /** Events whose players can be copied into the new one. */
  completedEvents?: CompletedEventOption[];
  /** The event "Same as last event" copies; without one the dialog goes straight to the steps. */
  templateEvent?: TemplateEvent | null;
  handicap?: EventSetupContext;
}

type Screen = 'start' | 'sentence' | 'steps';

const NO_HANDICAP: EventSetupContext = { leagueHandicaps: false, zones: [] };

function blankValues(ctx: EventSetupContext): Partial<CreateEventFormValues> {
  return { ...defaultEventSetup(ctx), event_date: undefined, location: '', access_code: generateAccessCode() };
}

export function CreateEventDialog({
  leagueId,
  leagueName,
  completedEvents = [],
  templateEvent = null,
  handicap = NO_HANDICAP,
}: CreateEventDialogProps) {
  const [open, setOpen] = useState(false);
  const [screen, setScreen] = useState<Screen>('steps');
  const [step, setStep] = useState(0);
  const [startChoice, setStartChoice] = useState<StartChoice>('template');
  const [copyTemplatePlayers, setCopyTemplatePlayers] = useState(true);
  const [copyFrom, setCopyFrom] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const form = useForm<CreateEventFormValues>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(createEventSchema) as any,
    defaultValues: blankValues(handicap),
  });

  const copySources: CopySource[] = useMemo(() => completedEvents.map((event) => ({
    id: event.id,
    label: [
      formatDisplayDate(parseLocalDate(event.event_date)),
      event.location,
      event.participant_count != null ? `${event.participant_count} players` : null,
    ].filter(Boolean).join(' · '),
  })), [completedEvents]);

  const [dateSuggestions, setDateSuggestions] = useState<Date[]>([]);

  const openDialog = () => {
    const suggestions = templateEvent
      ? upcomingWeekdayDates(parseLocalDate(templateEvent.event_date).getDay(), new Date())
      : [];
    setDateSuggestions(suggestions);
    form.reset({
      ...blankValues(handicap),
      ...(templateEvent ? { event_date: suggestions[0], location: templateEvent.location ?? '' } : {}),
    });
    setScreen(templateEvent ? 'start' : 'steps');
    setStep(0);
    setStartChoice('template');
    setCopyTemplatePlayers(true);
    setCopyFrom('');
    setError(null);
    setOpen(true);
  };

  const copyPlayersFrom = screen === 'sentence'
    ? (copyTemplatePlayers && templateEvent && templateEvent.participant_count > 0 ? templateEvent.id : null)
    : copyFrom || null;

  const submit = async (values: CreateEventFormValues) => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/league/${leagueId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(toCreateEventBody(values, copyPlayersFrom)),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || 'Failed to create event');
      if (!data?.id) throw new Error('Missing event ID in response');
      setOpen(false);
      router.push(`/admin/event/${data.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create event');
      if (screen === 'steps') setStep(STEPS.length - 1);
    } finally {
      setIsLoading(false);
    }
  };

  const onInvalid = (errors: FieldErrors<CreateEventFormValues>) => {
    if (screen === 'steps') {
      setStep(firstStepWith(Object.keys(errors) as CreateEventField[], form.getValues(), handicap));
    }
  };

  const next = async () => {
    if (screen === 'start') {
      if (!(await form.trigger(['event_date', 'location']))) return;
      if (startChoice === 'template' && templateEvent) {
        const setup = templateToSetupValues(templateEvent, handicap);
        for (const [key, value] of Object.entries(setup)) {
          form.setValue(key as keyof typeof setup, value as never);
        }
        setScreen('sentence');
      } else {
        const setup = defaultEventSetup(handicap);
        for (const [key, value] of Object.entries(setup)) {
          form.setValue(key as keyof typeof setup, value as never);
        }
        setScreen('steps');
        setStep(0);
      }
      return;
    }
    if (screen === 'steps' && step < STEPS.length - 1) {
      const fields = stepFields(STEPS[step].id, form.getValues(), handicap);
      if (await form.trigger(fields)) setStep(step + 1);
    }
  };

  const back = () => {
    setError(null);
    if (screen === 'sentence' || (screen === 'steps' && step === 0)) {
      setScreen('start');
    } else if (screen === 'steps') {
      setStep(step - 1);
    }
  };

  const isFinal = screen === 'sentence' || (screen === 'steps' && step === STEPS.length - 1);
  const canGoBack = screen === 'sentence' || (screen === 'steps' && (step > 0 || templateEvent !== null));

  return (
    <>
      <Button onClick={openDialog}>Create Event</Button>
      <Dialog open={open} onOpenChange={(next) => !isLoading && setOpen(next)}>
        <DialogContent className="flex max-h-[90vh] flex-col gap-0 p-0 max-sm:h-dvh max-sm:max-h-none max-sm:max-w-none max-sm:rounded-none sm:max-w-[720px]">
          <DialogHeader className="gap-0.5 border-b px-5 py-[22px] pr-14 text-left sm:px-7">
            <DialogTitle className="font-score text-[32px] leading-none">New event</DialogTitle>
            <DialogDescription>{leagueName ?? 'Create a new event for this league.'}</DialogDescription>
          </DialogHeader>

          <Form {...form}>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (isFinal) void form.handleSubmit(submit, onInvalid)(event);
                else void next();
              }}
              className="flex min-h-0 flex-1 flex-col"
              noValidate
            >
              {screen === 'steps' && <StepProgress current={step} onJump={setStep} />}

              <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 py-6 sm:px-7">
                {screen === 'start' && templateEvent && (
                  <StartScreen
                    ctx={handicap}
                    template={templateEvent}
                    dateSuggestions={dateSuggestions}
                    choice={startChoice}
                    onChoiceChange={setStartChoice}
                    copyPlayers={copyTemplatePlayers}
                    onCopyPlayersChange={setCopyTemplatePlayers}
                  />
                )}
                {screen === 'sentence' && templateEvent && (
                  <SentenceReview
                    ctx={handicap}
                    template={templateEvent}
                    copyPlayers={copyPlayersFrom !== null}
                    onRemovePlayers={() => setCopyTemplatePlayers(false)}
                  />
                )}
                {screen === 'steps' && (
                  <GuidedStep
                    step={step}
                    ctx={handicap}
                    copySources={copySources}
                    copyFrom={copyFrom}
                    onCopyFromChange={setCopyFrom}
                    onJump={setStep}
                  />
                )}
              </div>

              <div className="flex flex-col gap-2 border-t px-5 py-4 sm:px-7">
                {error && <p role="alert" className="text-sm font-medium text-destructive sm:text-right">{error}</p>}
                <div className="flex items-center justify-between gap-2.5">
                  {canGoBack ? (
                    <Button type="button" variant="outline" size="lg" onClick={back} disabled={isLoading}>Back</Button>
                  ) : (
                    <Button type="button" variant="outline" size="lg" onClick={() => setOpen(false)} disabled={isLoading}>
                      Cancel
                    </Button>
                  )}
                  {isFinal ? (
                    <Button type="submit" size="lg" disabled={isLoading} className="bg-success text-background hover:bg-success/90">
                      {isLoading ? 'Creating…' : 'Create event'}
                    </Button>
                  ) : (
                    <Button type="submit" size="lg">
                      {screen === 'start'
                        ? (startChoice === 'template' ? 'Review' : 'Next')
                        : `Next: ${STEPS[step + 1].label}`}
                      <ArrowRight aria-hidden="true" />
                    </Button>
                  )}
                </div>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </>
  );
}
