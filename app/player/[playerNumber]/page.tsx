'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PlayerHeader } from './components/player-header';
import { StatsOverview } from './components/stats-overview';
import { OngoingEvents } from './components/ongoing-events';
import { EventHistory } from './components/event-history';
import type { PlayerProfile } from '@/lib/types/player-statistics';

export default function PlayerProfilePage() {
  const { playerNumber } = useParams();
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchProfile() {
      try {
        setLoading(true);
        const response = await fetch(`/api/player/${playerNumber}`);

        if (!response.ok) {
          if (response.status === 404) {
            setError('Player not found');
          } else {
            const data = await response.json();
            setError(data.error || 'Failed to load player profile');
          }
          return;
        }

        const data = await response.json();
        setProfile(data);
        setError(null);
      } catch {
        setError('Failed to load player profile');
      } finally {
        setLoading(false);
      }
    }

    fetchProfile();
  }, [playerNumber]);

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto py-8 px-4 space-y-8">
        <div className="animate-pulse space-y-4">
          <div className="h-10 bg-muted rounded w-64"></div>
          <div className="h-6 bg-muted rounded w-48"></div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-8">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-24 bg-muted rounded"></div>
            ))}
          </div>
          <div className="h-64 bg-muted rounded mt-8"></div>
        </div>
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div className="max-w-4xl mx-auto py-8 px-4">
        <Link href="/players">
          <Button variant="ghost" className="mb-4">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Players
          </Button>
        </Link>
        <div className="text-center py-8">
          <p className="text-muted-foreground">{error || 'Player not found'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto py-8 px-4 space-y-8">
      <Link href="/players">
        <Button variant="ghost" className="mb-4">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Players
        </Button>
      </Link>

      <PlayerHeader player={profile.player} />
      <StatsOverview statistics={profile.statistics} />
      <OngoingEvents ongoingEvents={profile.ongoingEvents} />
      <EventHistory eventHistory={profile.eventHistory} />
    </div>
  );
}
