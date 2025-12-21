'use client';

import { useState, useEffect } from 'react';
import { EventHeader, PlayerManagement } from './components';
import { EventWithDetails } from './types';

export default function EventPage({
  params,
}: {
  params: { eventId: string } | Promise<{ eventId: string }>;
}) {
  const [event, setEvent] = useState<EventWithDetails | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadData = async () => {
      const { eventId } = await Promise.resolve(params);
      
      try {
        // Fetch event data via API
        const eventResponse = await fetch(`/api/event/${eventId}`);
        if (!eventResponse.ok) {
          throw new Error('Failed to fetch event');
        }
        const eventData = await eventResponse.json();
        
        try {
          const adminResponse = await fetch(`/api/league/${eventData.league_id}/is-admin`);
          console.log('Admin response status:', adminResponse.status);
          setIsAdmin(adminResponse.ok);
        } catch (error) {
          console.log('Admin check failed:', error);
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
  }, [params]);

  const handleStatusUpdate = (newStatus: EventWithDetails['status']) => {
    if (event) {
      setEvent(prev => prev ? { ...prev, status: newStatus } : null);
    }
  };

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
      <EventHeader event={event} onStatusUpdate={handleStatusUpdate} />
      <div className="mt-8">
        <PlayerManagement event={event} isAdmin={isAdmin} />
      </div>
    </div>
  );
}
