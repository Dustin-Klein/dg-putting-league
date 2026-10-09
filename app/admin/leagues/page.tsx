import { getUserAdminLeagues } from '@/lib/services/league';
import LeaguesList from './components/leagues-list';
import { describeError, logger } from '@/lib/utils/logger';
import { getRequestId } from '@/lib/utils/request-id';

export const dynamic = 'force-dynamic';

export default async function LeaguePage() {
  try {
    const leagues = await getUserAdminLeagues();

    return (
      <div className="container mx-auto p-4">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-bold">My Leagues</h1>
        </div>
        <LeaguesList leagues={leagues} />
      </div>
    );
  } catch (error) {
    logger.error('Error loading leagues', { requestId: await getRequestId(), ...describeError(error) });

    return (
      <div className="container mx-auto p-4">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-bold">My Leagues</h1>
        </div>
        <div className="text-red-500">
          Error loading leagues. Please try again later.
        </div>
      </div>
    );
  }
}
