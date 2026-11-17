'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useCoalescedRefresh } from '@/lib/hooks/use-coalesced-refresh';
import { createClient } from '@/lib/supabase/client';
import type { BracketWithTeams } from '@/lib/types/bracket';

interface EventBracketContextValue {
  bracketData: BracketWithTeams | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

const EventBracketContext = createContext<EventBracketContextValue | null>(null);

/** Null outside a live bracket; the header then shows no match or lane numbers. */
export function useEventBracket(): EventBracketContextValue | null {
  return useContext(EventBracketContext);
}

export function useRequiredEventBracket(): EventBracketContextValue {
  const value = useContext(EventBracketContext);
  if (!value) throw new Error('Must be rendered inside EventBracketProvider');
  return value;
}

/**
 * One bracket read and one realtime subscription for everything on the event page
 * that shows bracket state (the header and the bracket section).
 */
export function EventBracketProvider({ eventId, children }: { eventId: string; children: React.ReactNode }) {
  const [bracketData, setBracketData] = useState<BracketWithTeams | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchBracket = useCallback(async (signal: AbortSignal) => {
    try {
      setLoading(true);
      const response = await fetch(`/api/event/${eventId}/bracket`, { signal });

      if (!response.ok) {
        if (response.status === 404) {
          if (!signal.aborted) setError('Bracket not found.');
        } else {
          const data = await response.json();
          throw new Error(data.error || 'Failed to load bracket');
        }
        return;
      }

      const data = await response.json();
      if (signal.aborted) return;
      setBracketData(data);
      setError(null);
    } catch (err) {
      if (signal.aborted) return;
      setError(err instanceof Error ? err.message : 'Failed to load bracket');
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, [eventId]);
  const bracketRefresh = useCoalescedRefresh(fetchBracket, eventId);

  useEffect(() => {
    bracketRefresh.refresh();
  }, [bracketRefresh]);

  useEffect(() => {
    const supabase = createClient();

    const channel = supabase
      .channel(`bracket-section-${eventId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'putting_league',
          table: 'bracket_match',
          filter: `event_id=eq.${eventId}`,
        },
        () => {
          bracketRefresh.request();
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'putting_league',
          table: 'lanes',
          filter: `event_id=eq.${eventId}`,
        },
        () => { bracketRefresh.request(); }
      )
      // Realtime DELETE events cannot be filtered by event_id.
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'putting_league', table: 'lanes' },
        () => { bracketRefresh.request(); }
      )
      .subscribe();

    return () => {
      channel.unsubscribe();
    };
  }, [eventId, bracketRefresh]);

  return (
    <EventBracketContext.Provider value={{ bracketData, loading, error, refresh: bracketRefresh.refresh }}>
      {children}
    </EventBracketContext.Provider>
  );
}
