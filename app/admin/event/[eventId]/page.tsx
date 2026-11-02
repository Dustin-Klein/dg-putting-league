'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { EventHeader, PlayerManagement, BracketSection, TeamDisplay, ResultsDisplay, PayoutsDisplay } from './components';
import { EventWithDetails } from '@/lib/types/event';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EntryZoneCell, EventHandicapProvider, EventHandicapSummary } from './components/event-handicap';

function EventContent({
  event,
  isAdmin,
  onPlayersUpdate,
}: {
  event: EventWithDetails;
  isAdmin: boolean;
  onPlayersUpdate: (players: EventWithDetails['players']) => void;
}) {
  const hasEntryFee = event.entry_fee_per_player != null;

  if (event.status === 'completed') {
    const entries = new Map(event.players.map((entry) => [entry.id, entry]));
    return (
      <div className="space-y-8">
        <ResultsDisplay
          eventId={event.id}
          aside={hasEntryFee ? (
            <PayoutsDisplay eventId={event.id} eventStatus={event.status} isAdmin={isAdmin} />
          ) : null}
          memberAccessory={event.handicap_enabled ? (eventPlayerId) => {
            const entry = entries.get(eventPlayerId);
            return entry ? <EntryZoneCell entry={entry} compact /> : null;
          } : undefined}
        />
        <EventHandicapSummary />
      </div>
    );
  }

  if (event.status === 'bracket') {
    return (
      <Tabs defaultValue="bracket" className="w-full">
        <div className="flex justify-center mb-6">
          <TabsList>
            <TabsTrigger value="bracket">Bracket</TabsTrigger>
            <TabsTrigger value="teams">Teams ({event.teams?.length || 0})</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="bracket" className="space-y-4">
          <BracketSection eventId={event.id} isAdmin={isAdmin} doubleGrandFinal={event.double_grand_final} />
        </TabsContent>

        <TabsContent value="teams">
          <TeamDisplay event={event} isAdmin={isAdmin} />
        </TabsContent>
      </Tabs>
    );
  }

  return <PlayerManagement event={event} isAdmin={isAdmin} onPlayersUpdate={onPlayersUpdate} />;
}

export default function EventPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const [event, setEvent] = useState<EventWithDetails | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const eventIdRef = useRef<string | null>(null);

  const fetchEvent = useCallback(async (eventId: string) => {
    const eventResponse = await fetch(`/api/event/${eventId}`);
    if (!eventResponse.ok) {
      throw new Error('Failed to fetch event');
    }
    return await eventResponse.json();
  }, []);

  useEffect(() => {
    const loadData = async () => {
      const { eventId } = await params;
      eventIdRef.current = eventId;

      try {
        const eventData = await fetchEvent(eventId);
        setIsAdmin(eventData.viewer_is_admin === true);
        setEvent(eventData);
      } catch (error) {
        console.error('Failed to load event:', error);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [params, fetchEvent]);

  const handleStatusUpdate = useCallback(async () => {
    // Re-fetch the full event to get updated data including teams
    if (eventIdRef.current) {
      setLoading(true);
      try {
        const eventData = await fetchEvent(eventIdRef.current);
        setEvent(eventData);
      } catch (error) {
        console.error('Failed to refresh event:', error);
      } finally {
        setLoading(false);
      }
    }
  }, [fetchEvent]);

  const handlePlayersUpdate = useCallback((players: EventWithDetails['players']) => {
    setEvent(prev => prev ? { ...prev, players } : null);
  }, []);

  // Quiet re-fetch (no loading skeleton), e.g. after a handicap edit on one entry.
  const handleRefresh = useCallback(async () => {
    if (!eventIdRef.current) return;
    try {
      setEvent(await fetchEvent(eventIdRef.current));
    } catch (error) {
      console.error('Failed to refresh event:', error);
    }
  }, [fetchEvent]);

  if (loading || !event) {
    return (
      <div className="mx-auto max-w-[1200px] px-4 pt-8 pb-14 md:px-6">
        {/* Back link skeleton */}
        <Skeleton className="h-5 w-28 mb-4" />

        {/* Event header card skeleton */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex justify-between items-start">
              <div className="space-y-2">
                <Skeleton className="h-8 w-48" />
                <Skeleton className="h-5 w-32" />
              </div>
              <Skeleton className="h-10 w-32" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <div key={i} className="space-y-1">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-6 w-16" />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Content section skeleton */}
        <div className="mt-8 space-y-4">
          <Skeleton className="h-10 w-48" />
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="border rounded-lg p-4 space-y-3">
                <Skeleton className="h-6 w-32" />
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-9 w-full" />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const body = (
    <>
      <EventHeader event={event} onStatusUpdate={handleStatusUpdate} />
      <div className="mt-8">
        <EventContent event={event} isAdmin={isAdmin} onPlayersUpdate={handlePlayersUpdate} />
      </div>
    </>
  );

  return (
    <div className="mx-auto max-w-[1200px] px-4 pt-8 pb-14 md:px-6">
      <Link
        href={`/admin/leagues/${event.league_id}`}
        className="inline-flex min-h-8 items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-3"
      >
        <ChevronLeft className="size-4" aria-hidden="true" />
        Back to league
      </Link>
      {isAdmin && event.handicap_enabled ? (
        <EventHandicapProvider event={event} onEntriesChanged={handleRefresh}>{body}</EventHandicapProvider>
      ) : body}
    </div>
  );
}
