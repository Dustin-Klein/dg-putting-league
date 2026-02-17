"use client";

import { EventsList } from './events-list';
import { AdminManagement } from './admin-management';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { EventData } from '@/lib/repositories/event-repository';

type EventWithParticipantCount = EventData & { participant_count: number };

interface EventsContentProps {
  league: { name: string; city?: string | null };
  events: EventWithParticipantCount[];
  isAdmin: boolean;
  isOwner: boolean;
  leagueId: string;
}

export function EventsContent({ league, events, isAdmin, isOwner, leagueId }: EventsContentProps) {
  return (
    <div className="container mx-auto p-4">
      <div className="mb-6">
        <Link
          href={`/admin/leagues`}
          className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground mb-4"
        >
          <ChevronLeft className="w-4 h-4 mr-1" />
          Back to my leagues
        </Link>

        <div className="mb-6">
          <h1 className="text-2xl font-bold">{league.name}</h1>
          {league.city && (
            <p className="text-muted-foreground">{league.city}</p>
          )}
        </div>

        <EventsList
          events={events}
          leagueId={leagueId}
          isAdmin={isAdmin}
        />

        {isOwner && <AdminManagement leagueId={leagueId} />}
      </div>
    </div>
  );
}
