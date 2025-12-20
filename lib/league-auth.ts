import 'server-only';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export async function requireAuthenticatedUser() {
    const supabase = await createClient();

    const {
        data: { user },
        error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
        redirect('/auth/sign-in');
    }

    return user;
}

export async function requireLeagueAdmin(leagueId: string) {
    const supabase = await createClient();
    const user = await requireAuthenticatedUser();

    const { data: leagueAdmin } = await supabase
        .from('league_admins')
        .select('id')
        .eq('league_id', leagueId)
        .eq('user_id', user.id)
        .single();

    if (!leagueAdmin) {
        redirect('/leagues');
    }

    return {
        user,
        isAdmin: true,
    };
}
