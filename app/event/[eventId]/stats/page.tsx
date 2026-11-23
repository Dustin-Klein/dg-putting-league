import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getPublicEventStats } from '@/lib/services/event-stats';
import { NotFoundError } from '@/lib/errors';
import { LiveEventStats } from './live-event-stats';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Event stats' };

export default async function EventStatsPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  let stats;
  try {
    stats = await getPublicEventStats(eventId);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  return (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-9 px-4 pt-8 pb-14 md:px-6">
      <LiveEventStats initial={stats} />
    </div>
  );
}
