import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { UnauthorizedError, ForbiddenError } from '@/lib/errors';
import { getLeagueAdminByUserAndLeague } from '@/lib/repositories/league-repository';

export async function requireAuthenticatedUser() {
    const supabase = await createClient();

    const {
        data: { user },
        error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
        throw new UnauthorizedError('Authentication required');
    }

    return user;
}

export async function requireLeagueAdmin(leagueId: string) {
    const supabase = await createClient();
    const user = await requireAuthenticatedUser();

    const leagueAdmin = await getLeagueAdminByUserAndLeague(supabase, leagueId, user.id);

    if (!leagueAdmin) {
        throw new ForbiddenError('Insufficient permissions');
    }

    return {
        user,
        isAdmin: true,
    };
}
