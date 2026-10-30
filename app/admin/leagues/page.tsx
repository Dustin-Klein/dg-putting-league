import { getUserAdminLeagues } from '@/lib/services/league';
import LeaguesList from './components/leagues-list';
import { describeError, logger } from '@/lib/utils/logger';
import { getRequestId } from '@/lib/utils/request-id';

export const dynamic = 'force-dynamic';

export default async function LeaguePage() {
  try {
    const leagues = await getUserAdminLeagues();

    return (
      <div className="mx-auto max-w-[1200px] px-4 pt-10 pb-14 md:px-6">
        <LeaguesList leagues={leagues} />
      </div>
    );
  } catch (error) {
    logger.error('Error loading leagues', { requestId: await getRequestId(), ...describeError(error) });

    return (
      <div className="mx-auto max-w-[1200px] px-4 pt-10 pb-14 md:px-6">
        <div className="mb-6">
          <h1 className="font-score text-5xl leading-none font-bold">My Leagues</h1>
        </div>
        <div className="text-destructive">
          Error loading leagues. Please try again later.
        </div>
      </div>
    );
  }
}
