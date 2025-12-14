import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { CreateLeagueForm } from './CreateLeagueForm';

export default async function CreateLeaguePage() {
  const supabase = createClient();

  // Check if user is authenticated
  const { data: { user }, error: userError } = await (await supabase).auth.getUser();
  
  if (userError || !user) {
    redirect('/auth/sign-in');
  }

  return (
    <div className="container mx-auto p-4 max-w-2xl">
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Create New League</h1>
          <p className="text-muted-foreground">
            Set up a new disc golf putting league
          </p>
        </div>
        
        <CreateLeagueForm userId={user.id} />
      </div>
    </div>
  );
}
