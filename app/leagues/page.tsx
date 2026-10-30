import Link from 'next/link';
import { getPublicLeagues } from '@/lib/services/league/league-service';

export const dynamic = 'force-dynamic';

export default async function PublicLeaguesPage() {
  const leagues = await getPublicLeagues();

  return (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-6 px-4 pt-10 pb-14 md:px-6">
      <div className="flex flex-col gap-1.5">
        <h1 className="font-score text-5xl leading-none font-bold">Leagues</h1>
        <p className="text-base text-muted-foreground">Follow a league&apos;s live bracket and past results.</p>
      </div>

      {leagues.length === 0 ? (
        <div className="text-center py-12 border-2 border-dashed rounded-2xl">
          <h3 className="text-lg font-medium">No leagues available</h3>
          <p className="text-muted-foreground mt-2">
            Check back later for upcoming leagues.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(320px,100%),1fr))] gap-4">
          {leagues.map((league) => (
            <Link
              key={league.id}
              href={`/leagues/${league.id}`}
              className="flex flex-col gap-3.5 rounded-2xl border bg-card p-[22px] transition-colors hover:border-input"
            >
              <span className="text-[19px] font-bold">{league.name}</span>
              <div className="flex flex-col border-t border-muted pt-3.5">
                <span className="font-score text-[26px] leading-none font-bold tabular-nums">{league.event_count}</span>
                <span className="text-xs text-muted-foreground">{league.event_count === 1 ? 'Event' : 'Events'}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
