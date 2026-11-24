import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { getPublicLeagues } from '@/lib/services/league/league-service';
import { LeagueBoard } from '@/components/league/league-board';
import { NightStrip } from '@/components/league/night-strip';
import { StatusBadge } from '@/components/status-badge';
import { cn } from '@/lib/utils/utils';
import type { PublicLeagueSummary } from '@/lib/types/public';

export const dynamic = 'force-dynamic';

function liveProgress(league: PublicLeagueSummary) {
  return league.live_events
    .map((event) => {
      const label = event.second_chance ? 'Second chance' : 'Main bracket';
      return event.match_progress ? `${label} ${event.match_progress.played}/${event.match_progress.total}` : label;
    })
    .join(' · ');
}

function StatusPill({ league }: { league: PublicLeagueSummary }) {
  switch (league.status) {
    case 'live': {
      const progress = league.live_events[0]?.match_progress;
      return (
        <StatusBadge tone="success" dot>
          {progress ? `Bracket · ${progress.played} of ${progress.total}` : 'Bracket · live'}
        </StatusBadge>
      );
    }
    case 'qualifying':
      return <StatusBadge tone="warning">Qualifying</StatusBadge>;
    case 'scheduled':
      return <StatusBadge tone="outline">Scheduled</StatusBadge>;
    case 'idle':
      return null;
  }
}

function LeagueRow({ league }: { league: PublicLeagueSummary }) {
  const live = league.status === 'live' ? league.live_events[0] : undefined;
  const meta = [league.city, `${league.event_count} ${league.event_count === 1 ? 'event' : 'events'}`].filter(Boolean).join(' · ');
  return (
    <li
      className={cn(
        'flex flex-wrap items-center gap-x-6 gap-y-3.5 rounded-[14px] border bg-card px-4 py-[18px] sm:px-[22px]',
        live && 'border-[1.5px] border-success'
      )}
    >
      <div className="flex min-w-0 flex-[1_1_260px] flex-col gap-1.5">
        <Link href={`/leagues/${league.id}`} className="w-fit text-[19px] font-bold hover:underline">
          {league.name}
        </Link>
        <span className="text-sm text-muted-foreground">{meta}</span>
        <NightStrip season={league.season} className="mt-1" />
      </div>
      <div className="flex flex-wrap items-center gap-x-[18px] gap-y-2.5">
        <StatusPill league={league} />
        <span className="inline-flex gap-4 text-[15px] font-semibold whitespace-nowrap">
          {live && (
            <Link href={`/event/${live.id}/bracket`} className="inline-flex min-h-11 items-center text-success hover:underline">
              Watch →
            </Link>
          )}
          <Link href={`/leagues/${league.id}`} className="inline-flex min-h-11 items-center text-info hover:underline">
            League →
          </Link>
        </span>
      </div>
    </li>
  );
}

export default async function PublicLeaguesPage() {
  const leagues = await getPublicLeagues();
  const liveLeagues = leagues.filter((league) => league.status === 'live' && league.live_events.length > 0);

  return (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-5 px-4 pt-7 pb-14 md:px-6">
      <LeagueBoard
        kicker="Disc golf putting"
        title="Leagues"
        subtitle="Follow a league's live bracket and past results."
        aside={liveLeagues.length > 0 && (
          <div className="flex min-w-[260px] flex-col sm:flex-[0_1_360px] gap-2.5 rounded-[14px] border-[1.5px] border-success p-4">
            <span className="inline-flex items-center gap-1.5 text-[13px] font-bold text-success">
              <span className="size-2 rounded-full bg-success" aria-hidden="true" />
              Live now · {liveLeagues.length} {liveLeagues.length === 1 ? 'league' : 'leagues'}
            </span>
            {liveLeagues.map((league) => (
              <Link
                key={league.id}
                href={`/event/${league.live_events[0].id}/bracket`}
                className="flex min-h-[52px] items-center justify-between gap-3 rounded-[10px] bg-white/5 px-3 py-2 hover:bg-white/10"
              >
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-[15px] font-bold">{league.name}</span>
                  <span className="text-[13px] text-muted-foreground">{liveProgress(league)}</span>
                </span>
                <span className="inline-flex items-center gap-1 text-sm font-bold whitespace-nowrap text-success">
                  Watch
                  <ArrowRight className="size-4" aria-hidden="true" />
                </span>
              </Link>
            ))}
          </div>
        )}
      />

      <section aria-labelledby="all-leagues-heading" className="flex flex-col gap-3 pt-3">
        <h2 id="all-leagues-heading" className="text-xl font-bold">All leagues</h2>

        {leagues.length === 0 ? (
          <div className="flex flex-col items-center gap-3.5 rounded-2xl border-[1.5px] border-dashed bg-card px-8 py-12 text-center">
            <span aria-hidden="true" className="relative flex h-4 items-center gap-3.5">
              <span className="absolute inset-x-1 top-[7px] h-0.5 bg-border" />
              {[0, 1, 2].map((dot) => (
                <span key={dot} className="relative size-3 rounded-full border-2 border-muted-foreground bg-card" />
              ))}
            </span>
            <h3 className="font-score text-[34px] leading-none font-bold">No leagues yet</h3>
            <p className="max-w-[340px] text-[15px] text-muted-foreground">
              Check back soon. Leagues show up here once their first night is on the calendar.
            </p>
          </div>
        ) : (
          <ol aria-labelledby="all-leagues-heading" className="m-0 flex list-none flex-col gap-3 p-0">
            {leagues.map((league) => (
              <LeagueRow key={league.id} league={league} />
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
