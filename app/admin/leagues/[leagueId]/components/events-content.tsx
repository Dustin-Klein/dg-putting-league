"use client";

import { EventsList } from './events-list';
import { AdminManagement } from './admin-management';
import { HandicapManagement } from './handicap-management';
import { CreateEventDialog } from './create-event-dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LeagueBoard } from '@/components/league/league-board';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import type { AdminLeagueEvent } from '@/lib/services/event';
import type { EventSetupContext } from '@/lib/utils/event-setup';

interface EventsContentProps {
  league: { name: string; city?: string | null };
  events: AdminLeagueEvent[];
  isAdmin: boolean;
  isOwner: boolean;
  leagueId: string;
  initialTab?: 'events' | 'handicaps' | 'admins';
  handicap?: EventSetupContext;
}

export function EventsContent({ league, events, isAdmin, isOwner, leagueId, initialTab = 'events', handicap }: EventsContentProps) {
  // Newest first, as the list is ordered.
  const completedEvents = events.filter((event) => event.status === 'completed');

  return (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-5 px-4 pt-7 pb-14 md:px-6">
      <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Link href="/admin/leagues" className="inline-flex min-h-8 items-center gap-1 hover:text-foreground">
          <ChevronLeft className="size-4" aria-hidden="true" />
          My Leagues
        </Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page" className="truncate text-foreground">{league.name}</span>
      </nav>

      <LeagueBoard
        kicker="League admin"
        title={league.name}
        subtitle={
          <>
            {league.city && <>{league.city} · </>}
            <Link href={`/leagues/${leagueId}`} className="text-info hover:underline">
              Public page
            </Link>
            {handicap?.leagueHandicaps && <> · Zone handicaps on</>}
          </>
        }
        aside={isAdmin && events.length > 0 && (
          <CreateEventDialog
            leagueId={leagueId}
            leagueName={league.name}
            completedEvents={completedEvents}
            templateEvent={completedEvents.find((event) => event.parent_event_id === null) ?? null}
            handicap={handicap}
          />
        )}
      />

      <Tabs defaultValue={initialTab}>
        <TabsList className="mb-4">
          <TabsTrigger value="events">Events</TabsTrigger>
          {isAdmin && <TabsTrigger value="handicaps">Handicaps</TabsTrigger>}
          {isOwner && <TabsTrigger value="admins">Admins</TabsTrigger>}
        </TabsList>
        <TabsContent value="events">
          <EventsList
            events={events}
            leagueId={leagueId}
            leagueName={league.name}
            isAdmin={isAdmin}
            handicap={handicap}
          />
        </TabsContent>
        {isAdmin && (
          <TabsContent value="handicaps">
            <HandicapManagement leagueId={leagueId} />
          </TabsContent>
        )}
        {isOwner && (
          <TabsContent value="admins">
            <div className="max-w-[560px]">
              <AdminManagement leagueId={leagueId} />
            </div>
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
