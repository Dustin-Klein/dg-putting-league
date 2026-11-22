'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Maximize, Minimize, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ZoneBadge, zoneColorClass } from '@/components/zone-badge';
import { useCoalescedRefresh } from '@/lib/hooks/use-coalesced-refresh';
import { formatDisplayDate } from '@/lib/utils/date-utils';
import { cn } from '@/lib/utils/utils';
import type { EventWithDetails } from '@/lib/types/event';
import { recordRosterShown, rosterLayout, rosterRows, zoneCounts } from '@/lib/utils/roster-check';

/** event_players isn't in the realtime publication, so the screen polls. */
const POLL_MS = 10_000;
const PAGE_MS = 15_000;

/**
 * Full-screen "find your name and check your zone" list for the venue TV, shown while
 * registration is open so a missed or wrongly zoned player speaks up before teams are drawn.
 */
export function RosterScreen({ eventId }: { eventId: string }) {
  const router = useRouter();
  const [event, setEvent] = useState<EventWithDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [page, setPage] = useState(0);

  const load = useCallback(async (signal: AbortSignal) => {
    const response = await fetch(`/api/event/${eventId}`, { signal });
    if (signal.aborted) return;
    if (!response.ok) {
      setError(response.status === 404 ? 'Event not found' : 'Could not load the roster');
      return;
    }
    const data: EventWithDetails = await response.json();
    if (signal.aborted) return;
    if (!data.viewer_is_admin) {
      setError('Only league admins can show the roster');
      return;
    }
    setError(null);
    setEvent(data);
    recordRosterShown(eventId, data.players.map((player) => player.id));
  }, [eventId]);
  const refresh = useCoalescedRefresh(load, eventId);

  useEffect(() => {
    refresh.refresh();
    const timer = setInterval(refresh.refresh, POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  const exit = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    router.push(`/admin/event/${eventId}`);
  }, [eventId, router]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.fullscreenElement) exit();
    };
    const onFullscreen = () => setIsFullscreen(Boolean(document.fullscreenElement));
    window.addEventListener('keydown', onKey);
    document.addEventListener('fullscreenchange', onFullscreen);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('fullscreenchange', onFullscreen);
    };
  }, [exit]);

  const rows = useMemo(() => (event ? rosterRows(event.players) : []), [event]);
  const layout = useMemo(() => rosterLayout(rows), [rows]);
  const zones = useMemo(() => zoneCounts(event?.players ?? []), [event]);

  useEffect(() => {
    if (layout.pages.length < 2) return;
    const timer = setInterval(() => setPage((p) => (p + 1) % layout.pages.length), PAGE_MS);
    return () => clearInterval(timer);
  }, [layout.pages.length]);

  const currentPage = layout.pages[page % layout.pages.length] ?? [];
  const showZones = event?.handicap_enabled ?? false;

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen().catch(() => {});
  };

  return (
    <div className="dark fixed inset-0 z-40 flex flex-col gap-6 bg-board px-6 pt-8 pb-6 text-foreground sm:px-14">
      <div className="group absolute top-0 right-0 left-0 z-10 h-16">
        <div className="absolute top-3 right-4 flex gap-2 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          <Button variant="secondary" size="sm" onClick={toggleFullscreen}>
            {isFullscreen ? <Minimize className="mr-2 size-4" /> : <Maximize className="mr-2 size-4" />}
            {isFullscreen ? 'Exit full screen' : 'Full screen'}
          </Button>
          <Button variant="secondary" size="sm" onClick={exit}>
            <X className="mr-2 size-4" />
            Close
          </Button>
        </div>
      </div>

      <header className="flex flex-wrap items-end justify-between gap-6">
        <div className="flex min-w-0 flex-col gap-1.5">
          {event && (
            <p className="text-lg font-semibold text-muted-foreground">
              {formatDisplayDate(event.event_date)}
              {event.location ? ` · ${event.location}` : ''}
              {event.link_type === 'second_chance' ? ' · Second chance' : ' · Main event'}
            </p>
          )}
          <h1 className="font-score text-5xl leading-[0.95] font-bold lg:text-[68px]">
            {showZones ? 'Find your name and check your zone' : 'Find your name'}
          </h1>
        </div>
        <div className="flex items-center gap-7">
          <div className="flex flex-col items-end">
            <span className="font-score text-5xl leading-[0.9] font-bold tabular-nums lg:text-[68px]">{rows.length}</span>
            <span className="text-base font-semibold text-muted-foreground">players registered</span>
          </div>
          <span className="inline-flex items-center gap-2 rounded-full bg-success/15 px-3.5 py-2 text-[15px] font-semibold text-success">
            <span className="size-2.5 rounded-full bg-success" aria-hidden="true" />
            Updates live
          </span>
        </div>
      </header>

      {error ? (
        <p className="flex flex-1 items-center justify-center text-2xl text-muted-foreground">{error}</p>
      ) : !event ? (
        <div className="flex-1 rounded-2xl border bg-card/40" aria-busy="true" />
      ) : rows.length === 0 ? (
        <p className="flex flex-1 items-center justify-center rounded-2xl border bg-card text-2xl text-muted-foreground">
          No players registered yet
        </p>
      ) : (
        <ol
          aria-label="Registered players"
          className="m-0 grid min-h-0 flex-1 list-none content-start justify-center gap-x-6 gap-y-2 rounded-2xl border bg-card px-6 py-5"
          style={{
            gridAutoFlow: 'column',
            gridTemplateColumns: `repeat(${layout.columns}, minmax(0, 720px))`,
            gridTemplateRows: `repeat(${layout.rows}, minmax(0, ${layout.rowMaxPx}px))`,
          }}
        >
          {currentPage.map((row) => (
            <li
              key={row.eventPlayerId}
              className="flex min-h-0 min-w-0 items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/40 px-4"
            >
              <span className="truncate font-medium" style={{ fontSize: layout.fontPx }}>
                {row.name}
              </span>
              {showZones && <ZoneBadge zone={row.zone} distanceFt={row.distanceFt} size="lg" className="flex-none" />}
              {showZones && row.zone == null && (
                <span className="flex-none rounded-md border border-warning px-2.5 py-1 text-sm font-bold text-warning uppercase">
                  No zone
                </span>
              )}
            </li>
          ))}
        </ol>
      )}

      <footer className="flex flex-wrap items-center justify-between gap-6">
        <div className="flex items-center gap-4">
          <span className="inline-flex size-11 flex-none items-center justify-center rounded-xl bg-gold/15 text-gold">
            <AlertTriangle className="size-6" aria-hidden="true" />
          </span>
          <div className="flex flex-col gap-0.5">
            <p className="text-2xl font-bold">
              {showZones ? 'Paid but not listed, or in the wrong zone? Tell an organizer now.' : 'Paid but not listed? Tell an organizer now.'}
            </p>
            <p className="text-[17px] text-muted-foreground">
              Teams are drawn when registration closes.
              {layout.pages.length > 1 && ` Page ${(page % layout.pages.length) + 1} of ${layout.pages.length}.`}
            </p>
          </div>
        </div>
        {showZones && zones.length > 0 && (
          <div className="flex flex-wrap gap-2.5 text-[15px] font-semibold text-muted-foreground">
            {zones.map(({ zone, count }) => (
              <span key={zone} className="inline-flex items-center gap-2 rounded-full border px-3 py-1.5">
                <span className={cn('size-2.5 rounded-[3px] border', zoneColorClass(zone))} aria-hidden="true" />
                Zone {zone} · {count}
              </span>
            ))}
          </div>
        )}
      </footer>
    </div>
  );
}
