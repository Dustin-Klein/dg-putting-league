import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Target, Users } from 'lucide-react';

export default function Home() {
  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 flex flex-col items-center pt-16 md:pt-24 p-4">
        {/* Hero section for players */}
        <div className="max-w-2xl text-center mb-16">
          <div className="mb-6 flex justify-center">
            <div className="p-4 bg-primary/10 rounded-full">
              <Target className="h-16 w-16 text-primary" />
            </div>
          </div>
          <h1 className="text-4xl font-bold mb-4">DG Putting League</h1>
          <p className="text-xl text-muted-foreground mb-8">
            Playing in a league today? Jump right in and start tracking your scores.
          </p>
          <Button asChild size="lg" className="text-lg px-8 py-6">
            <Link href="/score">
              <Target className="mr-2 h-5 w-5" />
              Keep Score
            </Link>
          </Button>
        </div>

        {/* Divider */}
        <div className="w-full max-w-md border-t border-border mb-12" />

        {/* Secondary section for league organizers */}
        <div className="text-center">
          <div className="flex items-center justify-center gap-2 mb-3">
            <Users className="h-5 w-5 text-muted-foreground" />
            <p className="text-muted-foreground">
              Want to run your own putting league?
            </p>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link href="/auth/sign-up">
              Sign up to get started
            </Link>
          </Button>
        </div>
      </main>
    </div>
  );
}
