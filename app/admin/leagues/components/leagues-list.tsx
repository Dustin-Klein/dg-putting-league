"use client";

import Link from 'next/link';
import { formatShortDate } from '@/lib/utils/date-utils';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { LeagueWithRole } from '@/lib/types/league';
import { CreateLeagueDialog } from './create-league-dialog';
import { Trash2 } from 'lucide-react';
import { StatusBadge } from '@/components/status-badge';
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
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <h1 className="font-score text-5xl leading-none font-bold">My Leagues</h1>
          <p className="text-base text-muted-foreground">Leagues you organize.</p>
        </div>
        <CreateLeagueDialog />
      </div>

      {leagues.length === 0 ? (
        <div className="text-center py-12 border-2 border-dashed rounded-2xl">
          <h3 className="text-lg font-medium">No leagues found</h3>
          <p className="text-muted-foreground mt-2 mb-4">
            You don&apos;t have access to any leagues yet.
          </p>
          <CreateLeagueDialog />
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(340px,100%),1fr))] gap-4">
          {leagues.map((league) => (
            <article
              key={league.id}
              onClick={() => handleCardClick(league.id)}
              className="flex cursor-pointer flex-col gap-4 rounded-2xl border bg-card p-[22px] transition-colors hover:border-input"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 flex-col gap-1">
                  <h2 className="text-[19px] font-bold">{league.name}</h2>
                  {league.city && <p className="text-sm text-muted-foreground">{league.city}</p>}
                </div>
                <div className="flex shrink-0 items-start gap-2">
                  <StatusBadge tone="outline" className="capitalize">{league.role}</StatusBadge>
                  {league.role === 'owner' && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="text-destructive hover:bg-destructive/10"
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

              <div className="grid grid-cols-3 gap-4 border-t border-muted pt-3.5">
                <Stat value={league.eventCount} label="Total Events" />
                <Stat value={league.activeEventCount} label="Active Events" />
                <Stat
                  value={league.lastEventDate ? formatShortDate(league.lastEventDate) : '—'}
                  label={league.lastEventDate ? 'Last Event' : 'No events yet'}
                />
              </div>

              <div onClick={(e) => e.stopPropagation()}>
                <Link
                  href={`/admin/leagues/${league.id}`}
                  className="text-[15px] font-semibold text-info hover:underline"
                >
                  View Details →
                </Link>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ value, label }: { value: React.ReactNode; label: string }) {
  return (
    <div className="flex flex-col">
      <span className="font-score text-[26px] leading-none font-bold tabular-nums">{value}</span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}
