'use client';

import { useEffect, useState } from 'react';
import type { PublicEventStats } from '@/lib/types/event-stats';
import { EventStatsBody, ReportFooter, StatsHeader } from '@/components/event-stats/report';

const POLL_MS = 30_000;

/** The public report; while the bracket is live it refreshes through the rate-limited route. */
export function LiveEventStats({ initial }: { initial: PublicEventStats }) {
  const [stats, setStats] = useState(initial);
  const [updatedAt, setUpdatedAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const live = stats.event.status === 'bracket';

  useEffect(() => {
    if (!live) return;
    let cancelled = false;
    const refresh = async () => {
      if (document.visibilityState === 'hidden') return;
      try {
        const response = await fetch(`/api/public/event/${stats.event.id}/stats`, { cache: 'no-store' });
        if (!response.ok) return;
        const next = (await response.json()) as PublicEventStats;
        if (!cancelled) {
          setStats(next);
          setUpdatedAt(Date.now());
        }
      } catch {
        // Keep showing the last report; the next poll retries.
      }
    };
    const poll = setInterval(refresh, POLL_MS);
    const tick = setInterval(() => setNow(Date.now()), 5_000);
    return () => {
      cancelled = true;
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [live, stats.event.id]);

  const seconds = Math.max(0, Math.round((now - updatedAt) / 1000));
  return (
    <>
      <StatsHeader
        stats={stats}
        live={live}
        actions={live ? (
          <span className="self-center text-xs text-muted-foreground" aria-live="polite">
            Updated {seconds < 5 ? 'just now' : `${seconds} s ago`} · refreshes every 30 s
          </span>
        ) : null}
      />
      <EventStatsBody stats={stats} />
      <ReportFooter stats={stats} />
    </>
  );
}
