import { createClient } from '@/lib/supabase/server';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { CreateLeagueForm } from './CreateLeagueForm';

export default async function CreateLeaguePage() {
  const supabase = createClient();

  // Check if user is authenticated
  const { data: { user }, error: userError } = await (await supabase).auth.getUser();
  
  if (userError || !user) {
    redirect('/auth/login');
  }

  return (
    <div className="mx-auto max-w-[640px] px-4 pt-8 pb-14 md:px-6">
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-2.5">
          <Link
            href="/admin/leagues"
            className="inline-flex min-h-8 w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft className="size-4" aria-hidden="true" />
            My Leagues
          </Link>
          <h1 className="font-score text-5xl leading-none font-bold">Create New League</h1>
          <p className="text-muted-foreground">
            Set up a new disc golf putting league
          </p>
        </div>
        
        <CreateLeagueForm />
      </div>
    </div>
  );
}
