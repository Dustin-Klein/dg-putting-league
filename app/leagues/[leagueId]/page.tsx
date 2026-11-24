import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getPublicLeagueWithEvents } from '@/lib/services/league/league-service';
import { formatMonthDay } from '@/lib/utils/date-utils';
import { groupEventsIntoNights } from '@/lib/utils/league-nights';
import { EventStatusBadge } from '@/components/status-badge';
import { LeagueBoard } from '@/components/league/league-board';
import { LeagueTimeline } from '@/components/league/league-timeline';
import { SecondChanceMark } from '@/components/league/second-chance-mark';
import type { PublicEvent } from '@/lib/types/public';
import { ArrowRight, ChevronLeft } from 'lucide-react';

export const dynamic = 'force-dynamic';

function players(count: number) {
  return `${count} ${count === 1 ? 'player' : 'players'}`;
}

function eventMeta(event: PublicEvent) {
  return [
    event.location,
    players(event.participant_count),
    event.match_progress && `${event.match_progress.played} of ${event.match_progress.total} matches`,
  ]
    .filter(Boolean)
    .join(' · ');
}

function EventLinks({ event }: { event: PublicEvent }) {
  if (event.status !== 'bracket' && event.status !== 'completed') return null;
  return (
    <span className="inline-flex gap-4 text-[15px] font-semibold whitespace-nowrap text-info">
      <Link href={`/event/${event.id}/bracket`} className="hover:underline">
        {event.status === 'bracket' ? 'Watch' : 'Bracket'} →
      </Link>
      <Link href={`/event/${event.id}/stats`} className="hover:underline">Stats →</Link>
    </span>
  );
}

function EventRow({ event, title, compact = false }: { event: PublicEvent; title: React.ReactNode; compact?: boolean }) {
  return (
    <div className={compact ? 'flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3' : 'flex flex-wrap items-center gap-x-5 gap-y-2 px-[18px] py-3.5'}>
      <div className="flex min-w-[180px] flex-[1_1_200px] flex-col gap-0.5">
        {title}
        <span className={compact ? 'text-[13px] text-muted-foreground' : 'text-sm text-muted-foreground'}>{eventMeta(event)}</span>
      </div>
      <EventStatusBadge status={event.status} label={event.status === 'bracket' ? 'Bracket · live' : undefined} />
      <EventLinks event={event} />
    </div>
  );
}

function progressText(label: string, event: PublicEvent) {
  return event.match_progress ? `${label} ${event.match_progress.played}/${event.match_progress.total}` : label;
}

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

  const nights = groupEventsIntoNights(league.events);
  const liveNight = nights.find((night) =>
    [night.main, ...night.secondChances].some((event) => event.status === 'bracket')
  );
  const liveEvents = liveNight ? [liveNight.main, ...liveNight.secondChances].filter((event) => event.status === 'bracket') : [];

  return (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-5 px-4 pt-7 pb-14 md:px-6">
      <Link
        href="/leagues"
        className="inline-flex min-h-8 w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" aria-hidden="true" />
        All Leagues
      </Link>

      <LeagueBoard
        kicker="League"
        title={league.name}
        subtitle={[league.city, `${league.event_count} ${league.event_count === 1 ? 'event' : 'events'}`].filter(Boolean).join(' · ')}
        aside={liveNight && liveEvents[0] && (
          <Link
            href={`/event/${liveEvents[0].id}/bracket`}
            className="flex min-w-[260px] flex-col gap-2 rounded-[14px] border-[1.5px] border-success p-4 hover:bg-white/5"
          >
            <span className="inline-flex items-center gap-1.5 text-[13px] font-bold text-success">
              <span className="size-2 rounded-full bg-success" aria-hidden="true" />
              Live now · {formatMonthDay(liveNight.main.event_date)}
            </span>
            <span className="text-[15px] text-muted-foreground">
              {liveEvents
                .map((event) => progressText(event.link_type === 'second_chance' ? 'Second chance' : 'Main bracket', event))
                .join(' · ')}
            </span>
            <span className="inline-flex h-11 items-center justify-center gap-1.5 rounded-[10px] bg-primary text-[15px] font-bold text-primary-foreground">
              Watch live
              <ArrowRight className="size-[17px]" aria-hidden="true" />
            </span>
          </Link>
        )}
      />

      <section aria-labelledby="nights-heading" className="flex flex-col gap-3 pt-3">
        <h2 id="nights-heading" className="text-xl font-bold">Event nights</h2>

        {nights.length === 0 ? (
          <div className="text-center py-12 border-2 border-dashed rounded-2xl">
            <h3 className="text-lg font-medium">No events scheduled</h3>
            <p className="text-muted-foreground mt-2">
              Check back later for upcoming events.
            </p>
          </div>
        ) : (
          <LeagueTimeline
            nights={nights}
            label="Event nights"
            renderMain={(event) => (
              <EventRow
                event={event}
                title={event.link_type === 'second_chance'
                  ? <SecondChanceMark className="text-base" />
                  : <span className="text-base font-bold">Main event</span>}
              />
            )}
            renderSecondChance={(event) => (
              <EventRow event={event} compact title={<SecondChanceMark className="text-[15px]" iconClassName="size-[15px]" />} />
            )}
          />
        )}
      </section>
    </div>
  );
}
