"use client";

import { EventsList } from './events-list';
import { AdminManagement } from './admin-management';
import { HandicapManagement } from './handicap-management';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import type { EventData } from '@/lib/repositories/event-repository.db';

type EventWithParticipantCount = EventData & { participant_count: number };

interface EventsContentProps {
  league: { name: string; city?: string | null };
  events: EventWithParticipantCount[];
  isAdmin: boolean;
  isOwner: boolean;
  leagueId: string;
  initialTab?: 'events' | 'handicaps';
}

export function EventsContent({ league, events, isAdmin, isOwner, leagueId, initialTab = 'events' }: EventsContentProps) {
  return (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-6 px-4 pt-8 pb-14 md:px-6">
      <div className="flex flex-col gap-2.5">
        <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Link href="/admin/leagues" className="inline-flex min-h-8 items-center gap-1 hover:text-foreground">
            <ChevronLeft className="size-4" aria-hidden="true" />
            My Leagues
          </Link>
          <span aria-hidden="true">/</span>
          <span aria-current="page" className="truncate text-foreground">{league.name}</span>
        </nav>
        <div className="flex flex-col gap-1.5">
          <h1 className="font-score text-5xl leading-none font-bold">{league.name}</h1>
          <p className="text-[15px] text-muted-foreground">
            {league.city && <>{league.city} · </>}
            <Link href={`/leagues/${leagueId}`} className="text-info hover:underline">
              View public page
            </Link>
          </p>
        </div>
      </div>

      <Tabs defaultValue={initialTab}>
        <TabsList className="mb-2">
          <TabsTrigger value="events">Events</TabsTrigger>
          {isAdmin && <TabsTrigger value="handicaps">Handicaps</TabsTrigger>}
        </TabsList>
        <TabsContent value="events">
          <div className="flex flex-wrap items-start gap-6">
            <div className="min-w-0 flex-[999_1_560px]">
              <EventsList
                events={events}
                leagueId={leagueId}
                leagueName={league.name}
                isAdmin={isAdmin}
              />
            </div>
            {isOwner && (
              <div className="min-w-0 flex-[1_1_320px]">
                <AdminManagement leagueId={leagueId} />
              </div>
            )}
          </div>
        </TabsContent>
        {isAdmin && (
          <TabsContent value="handicaps">
            <HandicapManagement leagueId={leagueId} />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
