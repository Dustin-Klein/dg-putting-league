'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { EventHeader, PlayerManagement, BracketSection, TeamDisplay, ResultsDisplay } from './components';
import { EventWithDetails } from '@/lib/types/event';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent, CardHeader } from '@/components/ui/card';

function EventContent({
  event,
  isAdmin,
  onPlayersUpdate
}: {
  event: EventWithDetails;
  isAdmin: boolean;
  onPlayersUpdate: (players: EventWithDetails['players']) => void;
}) {
  if (event.status === 'completed') {
    return <ResultsDisplay eventId={event.id} />;
  }

  if (event.status === 'bracket') {
    return (
      <>
        <BracketSection eventId={event.id} />
        <TeamDisplay event={event} isAdmin={isAdmin} />
      </>
    );
  }

  return <PlayerManagement event={event} isAdmin={isAdmin} onPlayersUpdate={onPlayersUpdate} />;
}

export default function EventPage({
  params,
}: {
  params: { eventId: string } | Promise<{ eventId: string }>;
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
      const { eventId } = await Promise.resolve(params);
      eventIdRef.current = eventId;

      try {
        const eventData = await fetchEvent(eventId);

        try {
          const adminResponse = await fetch(`/api/league/${eventData.league_id}/is-admin`);
          setIsAdmin(adminResponse.ok);
        } catch {
          setIsAdmin(false);
        }

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

  if (loading || !event) {
    return (
      <div className="container mx-auto px-4 py-8">
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

  return (
    <div className="container mx-auto px-4 py-8">
      <Link
        href={`/league/${event.league_id}`}
        className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground mb-4"
      >
        <ChevronLeft className="w-4 h-4 mr-1" />
        Back to league
      </Link>
      <EventHeader event={event} onStatusUpdate={handleStatusUpdate} />
      <div className="mt-8">
        <EventContent event={event} isAdmin={isAdmin} onPlayersUpdate={handlePlayersUpdate} />
      </div>
    </div>
  );
}
