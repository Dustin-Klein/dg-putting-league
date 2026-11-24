"use client";

import Link from 'next/link';
import { useState } from 'react';
import { ArrowRight, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { LeagueCurrentNight, LeagueNightEvent, LeagueWithRole } from '@/lib/types/league';
import { CreateLeagueDialog } from './create-league-dialog';
import { StatusBadge } from '@/components/status-badge';
import { StatusTrack } from '@/components/event-status-track';
import { LeagueBoard } from '@/components/league/league-board';
import { NightStrip } from '@/components/league/night-strip';
import { MoneyNote } from '@/components/league/money-note';
import { LentLanes } from '@/components/league/lent-lanes';
import { SecondChanceMark } from '@/components/league/second-chance-mark';
import { TimelineBranch } from '@/components/league/league-timeline';
import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils/utils';

interface LeaguesListProps {
  leagues: LeagueWithRole[];
}

function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

function eventMeta(event: LeagueNightEvent) {
  return [
    plural(event.participant_count, 'player'),
    event.match_progress
      ? `${event.match_progress.played}/${event.match_progress.total} matches`
      : event.link_type !== 'second_chance' && plural(event.lane_count, 'lane'),
  ]
    .filter(Boolean)
    .join(' · ');
}

const NIGHT_LABEL: Record<LeagueCurrentNight['kind'], string> = {
  live: 'Live now',
  next: 'Up next',
  latest: 'Latest',
};

function Track({ event, className }: { event: LeagueNightEvent; className?: string }) {
  return (
    <StatusTrack
      compact
      status={event.status}
      qualifying={event.qualification_round_enabled}
      progress={event.match_progress && { done: event.match_progress.played, total: event.match_progress.total }}
      className={className}
    />
  );
}

function CurrentNight({ leagueId, night }: { leagueId: string; night: LeagueCurrentNight }) {
  const { main } = night;
  const scheduleNext = night.kind === 'latest' && main.status === 'completed';
  return (
    <div className="flex flex-col">
      <div className={cn('rounded-[14px] border bg-card px-[18px] py-3.5', main.status === 'bracket' && 'border-[1.5px] border-success')}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span
            className={cn(
              'text-xs font-bold tracking-[0.08em] uppercase',
              night.kind === 'live' ? 'text-success' : 'text-muted-foreground'
            )}
          >
            {NIGHT_LABEL[night.kind]}
          </span>
          <Link href={`/admin/event/${main.id}`} className="flex-[1_1_120px] text-base font-bold hover:underline">
            {main.link_type === 'second_chance' ? <SecondChanceMark /> : 'Main event'}
          </Link>
          {main.qualification_round_enabled && <StatusBadge tone="outline">Qualification round</StatusBadge>}
          <Link
            href={`/admin/event/${main.id}`}
            className="inline-flex min-h-8 items-center text-[15px] font-semibold text-info hover:underline"
          >
            Open event →
          </Link>
        </div>
        <div className="mt-3 flex flex-wrap items-end gap-x-[26px] gap-y-2.5">
          <Track event={main} className="flex-[1_1_240px]" />
          <span className="text-sm text-muted-foreground">{eventMeta(main)}</span>
          <MoneyNote event={main} />
        </div>
      </div>

      {night.secondChances.map((event) => (
        <TimelineBranch key={event.id}>
          <div className={cn('flex flex-col gap-2.5 rounded-xl bg-info/10 px-4 py-3', event.status === 'bracket' && 'ring-[1.5px] ring-success')}>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
              <Link href={`/admin/event/${event.id}`} className="min-w-[140px] flex-[1_1_160px] text-[15px] hover:underline">
                <SecondChanceMark iconClassName="size-[15px]" />
              </Link>
              <LentLanes labels={event.borrowed_lane_labels} />
            </div>
            <div className="flex flex-wrap items-end gap-x-7 gap-y-2">
              <Track event={event} className="flex-[1_1_240px]" />
              <span className="text-[13px] text-muted-foreground">{eventMeta(event)}</span>
              <MoneyNote event={event} />
            </div>
          </div>
        </TimelineBranch>
      ))}

      {scheduleNext && (
        <TimelineBranch dashed>
          <Link
            href={`/admin/leagues/${leagueId}`}
            className="inline-flex min-h-12 w-full items-center gap-2 rounded-xl border-[1.5px] border-dashed border-input px-4 text-[15px] font-semibold text-muted-foreground hover:bg-muted"
          >
            <Plus className="size-4" strokeWidth={2.25} aria-hidden="true" />
            Schedule the next night
          </Link>
        </TimelineBranch>
      )}
    </div>
  );
}

function LeagueCard({
  league,
  deleting,
  onDelete,
}: {
  league: LeagueWithRole;
  deleting: boolean;
  onDelete: () => void;
}) {
  const isOwner = league.role === 'owner';
  return (
    <li className="overflow-hidden rounded-2xl border bg-card">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5 px-4 pt-[18px] pb-3.5 sm:px-[22px]">
        <div className="flex min-w-0 flex-[1_1_240px] flex-col gap-1">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2">
            <Link href={`/admin/leagues/${league.id}`} className="text-xl font-bold hover:underline">
              {league.name}
            </Link>
            <StatusBadge tone={isOwner ? 'neutral' : 'outline'} className={cn('capitalize', isOwner && 'bg-foreground text-background')}>
              {league.role}
            </StatusBadge>
          </div>
          {league.city && <span className="text-sm text-muted-foreground">{league.city}</span>}
        </div>
        <div className="flex items-center gap-1">
          <Button variant="outline" asChild>
            <Link href={`/admin/leagues/${league.id}`}>Open league</Link>
          </Button>
          {isOwner && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              onClick={onDelete}
              disabled={deleting}
            >
              <Trash2 className="h-4 w-4" />
              <span className="sr-only">Delete {league.name}</span>
            </Button>
          )}
        </div>
      </div>

      <div className="px-4 pb-[18px] sm:px-[22px]">
        {league.currentNight ? (
          <CurrentNight leagueId={league.id} night={league.currentNight} />
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-3 rounded-xl border-[1.5px] border-dashed border-input px-[18px] py-4">
            <div className="flex flex-col gap-0.5">
              <span className="text-[15px] font-bold">No events yet</span>
              <span className="text-sm text-muted-foreground">Create the first night to open registration.</span>
            </div>
            <Button asChild>
              <Link href={`/admin/leagues/${league.id}`}>
                <Plus className="size-4" aria-hidden="true" />
                Create event
              </Link>
            </Button>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-7 gap-y-3.5 border-t border-muted px-4 py-3.5 sm:px-[22px]">
        <div className="flex gap-9">
          <Stat value={league.eventCount} label={league.eventCount === 1 ? 'Event' : 'Events'} />
          <Stat value={league.activeEventCount} label="Active" />
        </div>
        <NightStrip season={league.season} />
      </div>
    </li>
  );
}

function liveSummary(night: LeagueCurrentNight) {
  const events = [night.main, ...night.secondChances];
  const progress = events
    .filter((event) => event.status === 'bracket')
    .map((event) => {
      const label = event.link_type === 'second_chance' ? 'Second chance' : 'Main bracket';
      return event.match_progress ? `${label} ${event.match_progress.played}/${event.match_progress.total}` : label;
    });
  const unpaid = events.reduce((sum, event) => sum + event.participant_count - event.paid_count, 0);
  return [...progress, unpaid > 0 && `${unpaid} unpaid`].filter(Boolean).join(' · ');
}

export default function LeaguesList({ leagues }: LeaguesListProps) {
  const { toast } = useToast();
  const [deletingLeagueId, setDeletingLeagueId] = useState<string | null>(null);

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

  const owned = leagues.filter((league) => league.role === 'owner').length;
  const live = leagues.find((league) => league.currentNight?.kind === 'live');

  return (
    <div className="flex flex-col gap-5">
      <LeagueBoard
        kicker="League admin"
        title="My Leagues"
        subtitle={leagues.length === 0
          ? 'Start your first league: set it up once, then add a night each week.'
          : `${plural(leagues.length, 'league')} you organize · ${owned} owned`}
        actions={
          <>
            <CreateLeagueDialog />
            {leagues.length === 0 && (
              <span className="self-center text-sm text-muted-foreground">Invited to help run one? Ask its owner to add you.</span>
            )}
          </>
        }
        aside={live?.currentNight && (
          <Link
            href={`/admin/event/${live.currentNight.main.id}`}
            className="flex min-w-[260px] flex-col sm:flex-[0_1_340px] gap-2 rounded-[14px] border-[1.5px] border-success p-4 hover:bg-white/5"
          >
            <span className="inline-flex items-center gap-1.5 text-[13px] font-bold text-success">
              <span className="size-2 rounded-full bg-success" aria-hidden="true" />
              Live now
            </span>
            <span className="text-[17px] font-bold">{live.name}</span>
            <span className="text-sm text-muted-foreground">{liveSummary(live.currentNight)}</span>
            <span className="mt-1 inline-flex h-11 items-center justify-center gap-1.5 rounded-[10px] bg-primary text-[15px] font-bold text-primary-foreground">
              Run event
              <ArrowRight className="size-[17px]" aria-hidden="true" />
            </span>
          </Link>
        )}
      />

      {leagues.length > 0 && (
        <section aria-labelledby="your-leagues-heading" className="flex flex-col gap-3 pt-3">
          <h2 id="your-leagues-heading" className="text-xl font-bold">Your leagues</h2>
          <ol aria-labelledby="your-leagues-heading" className="m-0 flex list-none flex-col gap-3.5 p-0">
            {leagues.map((league) => (
              <LeagueCard
                key={league.id}
                league={league}
                deleting={deletingLeagueId === league.id}
                onDelete={() => void handleDeleteLeague(league.id)}
              />
            ))}
          </ol>
        </section>
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
