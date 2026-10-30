import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getPublicLeagueWithEvents } from '@/lib/services/league/league-service';
import { formatDisplayDate } from '@/lib/utils/date-utils';
import { EventStatusBadge } from '@/components/status-badge';
import { ArrowRight, ChevronLeft } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function PublicLeaguePage({
  params: paramsPromise,
}: {
  params: Promise<{ leagueId: string }>;
}) {
  const params = await paramsPromise;

  let league;
  try {
    league = await getPublicLeagueWithEvents(params.leagueId);
  } catch {
    notFound();
  }

  const liveEvent = league.events.find((event) => event.status === 'bracket');

  return (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-7 px-4 pt-8 pb-14 md:px-6">
      <div className="flex flex-col gap-2.5">
        <Link
          href="/leagues"
          className="inline-flex min-h-8 w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
          All Leagues
        </Link>
        <h1 className="font-score text-5xl leading-none font-bold">{league.name}</h1>
      </div>

      {liveEvent && (
        <Link
          href={`/event/${liveEvent.id}/bracket`}
          className="flex flex-wrap items-center gap-x-8 gap-y-5 rounded-[18px] border-[1.5px] border-success bg-card p-6"
        >
          <div className="flex flex-[1_1_280px] flex-col gap-1.5">
            <EventStatusBadge status="bracket" label="Bracket play · live" className="w-fit" />
            <span className="font-score text-[34px] leading-[1.05] font-bold">
              {formatDisplayDate(liveEvent.event_date)}
            </span>
            <span className="text-[15px] text-muted-foreground">
              {[
                liveEvent.location,
                `${liveEvent.participant_count} ${liveEvent.participant_count === 1 ? 'participant' : 'participants'}`,
              ]
                .filter(Boolean)
                .join(' · ')}
            </span>
          </div>
          <span className="inline-flex h-12 items-center gap-1.5 rounded-xl bg-primary px-[18px] text-[15px] font-bold text-primary-foreground">
            Watch bracket
            <ArrowRight className="size-[18px]" aria-hidden="true" />
          </span>
        </Link>
      )}

      <section aria-labelledby="events-heading" className="flex flex-col gap-3">
        <h2 id="events-heading" className="text-xl font-bold">All events</h2>

        {league.events.length === 0 ? (
          <div className="text-center py-12 border-2 border-dashed rounded-2xl">
            <h3 className="text-lg font-medium">No events scheduled</h3>
            <p className="text-muted-foreground mt-2">
              Check back later for upcoming events.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border bg-card">
            <table className="w-full min-w-[560px] text-[15px]">
              <thead>
                <tr className="text-left text-xs font-bold tracking-[0.06em] text-muted-foreground uppercase">
                  <th scope="col" className="px-5 py-3.5">Date</th>
                  <th scope="col" className="px-2 py-3.5">Location</th>
                  <th scope="col" className="px-2 py-3.5">Participants</th>
                  <th scope="col" className="px-2 py-3.5">Status</th>
                  <th scope="col" className="px-5 py-3.5 text-right"><span className="sr-only">Bracket</span></th>
                </tr>
              </thead>
              <tbody>
                {league.events.map((event) => {
                  const hasBracket = event.status === 'bracket' || event.status === 'completed';
                  return (
                    <tr key={event.id} className="border-t border-muted">
                      <td className="px-5 py-3.5 font-semibold whitespace-nowrap">{formatDisplayDate(event.event_date)}</td>
                      <td className="px-2 py-3.5 text-muted-foreground">{event.location ?? '—'}</td>
                      <td className="px-2 py-3.5 tabular-nums">{event.participant_count}</td>
                      <td className="px-2 py-3.5"><EventStatusBadge status={event.status} /></td>
                      <td className="px-5 py-3.5 text-right whitespace-nowrap">
                        {hasBracket && (
                          <Link href={`/event/${event.id}/bracket`} className="font-semibold text-info hover:underline">
                            {event.status === 'bracket' ? 'Live bracket' : 'View Bracket'} →
                          </Link>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
