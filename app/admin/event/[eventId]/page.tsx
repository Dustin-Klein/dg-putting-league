'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { EventHeader, PlayerManagement, BracketSection, TeamDisplay, ResultsDisplay, PayoutsDisplay } from './components';
import { EventWithDetails } from '@/lib/types/event';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EntryZoneCell, EventHandicapProvider, EventHandicapSummary } from './components/event-handicap';
import { EventBracketProvider } from './components/event-bracket-context';
import { SecondChancePanel, SecondChanceRosterPanel } from './components/second-chance';

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

        {/* Event header skeleton */}
        <div className="flex flex-col gap-[18px]">
          <div className="flex items-center justify-between gap-6 rounded-[18px] border px-[30px] py-[26px]">
            <div className="space-y-2.5">
              <Skeleton className="h-14 w-64" />
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-4 w-80" />
            </div>
            <Skeleton className="hidden h-[60px] w-72 sm:block" />
          </div>
          <div className="flex items-center justify-between gap-4">
            <Skeleton className="h-8 w-full max-w-[624px]" />
            <Skeleton className="h-11 w-36" />
          </div>
          <div className="grid grid-cols-2 gap-4 border-t pt-4 sm:grid-cols-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="space-y-1.5">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-8 w-16" />
              </div>
            ))}
          </div>
        </div>

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

  const secondChance = !isAdmin ? null
    : event.link_type === 'second_chance'
      ? <SecondChanceRosterPanel event={event} onPlayersAdded={handleRefresh} />
      : event.status === 'bracket' || event.status === 'completed'
        ? <SecondChancePanel event={event} />
        : null;

  const content = (
    <>
      <EventHeader event={event} onStatusUpdate={handleStatusUpdate} />
      {secondChance && <div className="mt-6">{secondChance}</div>}
      <div className="mt-8">
        <EventContent event={event} isAdmin={isAdmin} onPlayersUpdate={handlePlayersUpdate} />
      </div>
    </>
  );
  const body = event.status === 'bracket'
    ? <EventBracketProvider eventId={event.id}>{content}</EventBracketProvider>
    : content;

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
