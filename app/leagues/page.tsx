import { requireAuthenticatedUser } from '@/lib/auth/league-auth';
import { getUserAdminLeagues } from '@/lib/league';
import LeaguesList from './LeaguesList';

export default async function LeaguePage() {
  try {
    const user = await requireAuthenticatedUser();
    const leagues = await getUserAdminLeagues(user.id);

    return (
      <div className="container mx-auto p-4">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-bold">My Leagues</h1>
        </div>
        <LeaguesList leagues={leagues} />
      </div>
    );
  } catch (error) {
    console.error('Error loading leagues:', error);

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
