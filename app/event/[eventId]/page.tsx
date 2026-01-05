'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { EventHeader, PlayerManagement, BracketSection, TeamDisplay, ResultsDisplay } from './components';
import { EventWithDetails } from '@/lib/types/event';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';

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
        <div className="animate-pulse">
          <div className="h-8 bg-muted rounded mb-4"></div>
          <div className="h-32 bg-muted rounded"></div>
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
