'use client';

import { useState } from 'react';
import Link from 'next/link';
import { formatDisplayDate } from '@/lib/utils/date-utils';
import { Button } from '@/components/ui/button';
import type { AdminLeagueEvent } from '@/lib/services/event';
import { CreateEventDialog } from './create-event-dialog';
import { Plus, Trash2 } from 'lucide-react';
import { StatusBadge } from '@/components/status-badge';
import { StatusTrack } from '@/components/event-status-track';
import { LeagueTimeline, TimelineBranch } from '@/components/league/league-timeline';
import { SecondChanceMark } from '@/components/league/second-chance-mark';
import { useToast } from '@/components/ui/use-toast';
import { eventDistanceLabel, type EventSetupContext } from '@/lib/utils/event-setup';
import { MoneyNote } from '@/components/league/money-note';
import { LentLanes } from '@/components/league/lent-lanes';
import { groupEventsIntoNights, type LeagueNight } from '@/lib/utils/league-nights';
import { cn } from '@/lib/utils/utils';

interface EventsListProps {
  events: AdminLeagueEvent[] | null;
  leagueId: string;
  leagueName?: string;
  isAdmin?: boolean;
  handicap?: EventSetupContext;
}

function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

function eventMeta(event: AdminLeagueEvent) {
  const isSecondChance = event.link_type === 'second_chance';
  return [
    plural(event.participant_count, 'player'),
    event.match_progress
      ? `${event.match_progress.played}/${event.match_progress.total} matches`
      : !isSecondChance && plural(event.lane_count, 'lane'),
    eventDistanceLabel(event),
  ]
    .filter(Boolean)
    .join(' · ');
}

/** The main event most recently finished or still in bracket play may still get a second chance. */
function canAddSecondChance(night: LeagueNight<AdminLeagueEvent>, latestCompletedId: string | undefined) {
  const { main } = night;
  if (main.parent_event_id !== null || night.secondChances.length > 0) return false;
  return main.status === 'bracket' || main.id === latestCompletedId;
}

export function EventsList({ events = [], leagueId, leagueName, isAdmin = false, handicap }: EventsListProps) {
  const [deletingEventId, setDeletingEventId] = useState<string | null>(null);
  const { toast } = useToast();

  const handleDeleteEvent = async (eventId: string) => {
    if (!confirm('Are you sure you want to delete this event? This action cannot be undone.')) {
      return;
    }

    setDeletingEventId(eventId);

    try {
      const response = await fetch(`/api/event/${eventId}`, {
        method: 'DELETE',
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to delete event');
      }

      toast({
        title: 'Success',
        description: 'Event deleted successfully',
      });

      // Refresh the page to update the list
      window.location.reload();
    } catch (error) {
      console.error('Error deleting event:', error);
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to delete event',
        variant: 'destructive',
      });
    } finally {
      setDeletingEventId(null);
    }
  };

  if (!events || events.length === 0) {
    return (
      <div className="text-center py-12 border-2 border-dashed rounded-2xl">
        <h3 className="text-lg font-medium">No events scheduled yet</h3>
        <p className="text-muted-foreground mt-2 mb-4">
          This league doesn&apos;t have any events yet. {isAdmin && 'Create one to get started.'}
        </p>
        {isAdmin && <CreateEventDialog leagueId={leagueId} leagueName={leagueName} handicap={handicap} />}
      </div>
    );
  }

  const nights = groupEventsIntoNights(events);
  const latestCompletedId = events.find((event) => event.status === 'completed' && event.parent_event_id === null)?.id;

  const actions = (event: AdminLeagueEvent, secondChance: boolean) => (
    <span className="flex items-center gap-1">
      <Button variant="outline" asChild className={cn(secondChance && 'border-info/60 text-info hover:text-info')}>
        <Link href={`/admin/event/${event.id}`}>Open</Link>
      </Button>
      {isAdmin && (
        <Button
          variant="ghost"
          size="icon"
          className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          onClick={() => handleDeleteEvent(event.id)}
          disabled={deletingEventId === event.id}
        >
          <Trash2 className="h-4 w-4" />
          <span className="sr-only">Delete event on {formatDisplayDate(event.event_date)}</span>
        </Button>
      )}
    </span>
  );

  const track = (event: AdminLeagueEvent) => (
    <StatusTrack
      compact
      status={event.status}
      qualifying={event.qualification_round_enabled}
      progress={event.match_progress && { done: event.match_progress.played, total: event.match_progress.total }}
      className="flex-[1_1_240px]"
    />
  );

  return (
    <LeagueTimeline
      nights={nights}
      renderMain={(event) => {
        const secondChance = event.link_type === 'second_chance';
        return (
          <div className="flex flex-col gap-3 px-[18px] py-4">
            <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2">
              <Link href={`/admin/event/${event.id}`} className="min-w-[140px] flex-[1_1_160px] text-base font-bold hover:underline">
                {secondChance ? <SecondChanceMark /> : 'Main event'}
              </Link>
              {event.qualification_round_enabled && <StatusBadge tone="outline">Qualification round</StatusBadge>}
              {actions(event, false)}
            </div>
            <div className="flex flex-wrap items-end gap-x-7 gap-y-3">
              {track(event)}
              <span className="text-sm text-muted-foreground">{eventMeta(event)}</span>
              <MoneyNote event={event} />
            </div>
          </div>
        );
      }}
      renderSecondChance={(event) => (
        <div className="flex flex-col gap-2.5 px-4 py-3">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <Link href={`/admin/event/${event.id}`} className="min-w-[140px] flex-[1_1_160px] text-[15px] hover:underline">
              <SecondChanceMark iconClassName="size-[15px]" />
            </Link>
            <LentLanes labels={event.borrowed_lane_labels} />
            {actions(event, true)}
          </div>
          <div className="flex flex-wrap items-end gap-x-7 gap-y-2">
            {track(event)}
            <span className="text-[13px] text-muted-foreground">{eventMeta(event)}</span>
            <MoneyNote event={event} />
          </div>
        </div>
      )}
      after={(night) =>
        isAdmin && canAddSecondChance(night, latestCompletedId) && (
          <TimelineBranch dashed>
            <Link
              href={`/admin/event/${night.main.id}`}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl border-[1.5px] border-dashed border-input px-4 text-sm font-bold text-info hover:bg-info/10"
            >
              <Plus className="size-[15px]" strokeWidth={2.5} aria-hidden="true" />
              Add second chance
            </Link>
          </TimelineBranch>
        )
      }
    />
  );
}
