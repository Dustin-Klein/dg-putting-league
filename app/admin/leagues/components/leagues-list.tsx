"use client";

import Link from 'next/link';
import { formatShortDate } from '@/lib/utils/date-utils';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { LeagueWithRole } from '@/lib/types/league';
import { CreateLeagueDialog } from './create-league-dialog';
import { Trash2 } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';

interface LeaguesListProps {
  leagues: LeagueWithRole[];
}

export default function LeaguesList({ leagues }: LeaguesListProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [deletingLeagueId, setDeletingLeagueId] = useState<string | null>(null);

  const handleCardClick = (leagueId: string) => {
    router.push(`/admin/leagues/${leagueId}`);
  };

  const handleDeleteLeague = async (leagueId: string) => {
    if (!confirm('Are you sure you want to delete this league? This action cannot be undone.')) {
      return;
    }

    setDeletingLeagueId(leagueId);

    try {
      const response = await fetch(`/api/league/${leagueId}`, {
        method: 'DELETE',
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to delete league');
      }

      window.location.reload();
    } catch (error) {
      console.error('Error deleting league:', error);
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to delete league',
        variant: 'destructive',
      });
    } finally {
      setDeletingLeagueId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end mb-4">
        <CreateLeagueDialog />
      </div>

      {leagues.length === 0 ? (
        <div className="text-center py-12 border-2 border-dashed rounded-lg">
          <h3 className="text-lg font-medium">No leagues found</h3>
          <p className="text-muted-foreground mt-2 mb-4">
            You don&apos;t have access to any leagues yet.
          </p>
          <CreateLeagueDialog />
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {leagues.map((league) => (
            <div
              key={league.id}
              onClick={() => handleCardClick(league.id)}
              className="border rounded-lg p-4 hover:shadow-md transition-shadow hover:border-primary cursor-pointer"
            >
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="font-semibold text-lg">{league.name}</h3>
                  {league.city && <p className="text-muted-foreground">{league.city}</p>}
                </div>
                <div className="flex items-start gap-2">
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                    {league.role}
                  </span>
                  {league.role === 'owner' && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive hover:bg-destructive/10"
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleDeleteLeague(league.id);
                      }}
                      disabled={deletingLeagueId === league.id}
                    >
                      <Trash2 className="h-4 w-4" />
                      <span className="sr-only">Delete league</span>
                    </Button>
                  )}
                </div>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground">Total Events</p>
                  <p className="font-medium">{league.eventCount}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Active Events</p>
                  <p className="font-medium">{league.activeEventCount}</p>
                </div>
                <div className="col-span-2">
                  <p className="text-muted-foreground">Last Event</p>
                  <p className="font-medium">
                    {league.lastEventDate
                      ? formatShortDate(league.lastEventDate)
                      : 'No events yet'}
                  </p>
                </div>
              </div>

              <div className="mt-4" onClick={(e) => e.stopPropagation()}>
                <Button variant="outline" size="sm" asChild>
                  <Link href={`/admin/leagues/${league.id}`}>View Details</Link>
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
