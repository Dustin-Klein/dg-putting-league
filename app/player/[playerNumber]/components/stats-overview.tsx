'use client';

import type { PlayerStatistics } from '@/lib/types/player-statistics';

interface StatsOverviewProps {
  statistics: PlayerStatistics;
}

export function StatsOverview({ statistics }: StatsOverviewProps) {
  const formatPercent = (value: number): string => {
    return `${(value * 100).toFixed(1)}%`;
  };

  const formatPFA = (value: number | null): string => {
    if (value === null) return '-';
    return value.toFixed(3);
  };

  return (
    <section aria-labelledby="stats-heading" className="flex flex-col gap-3">
      <h2 id="stats-heading" className="text-xl font-bold">Statistics</h2>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3">
        <StatCard
          title="Events Played"
          value={statistics.eventsPlayed.toString()}
        />
        <StatCard
          title="Win Rate"
          value={formatPercent(statistics.winRate)}
          subtitle={`${statistics.totalWins}W - ${statistics.totalLosses}L`}
        />
        <StatCard
          title="Per-Frame Average"
          value={formatPFA(statistics.perFrameAverage)}
        />
        <StatCard
          title="Perfect Matches"
          value={statistics.perfectMatches.toString()}
          subtitle="All 3-putt frames"
        />
        <StatCard
          title="1st Place Finishes"
          value={statistics.firstPlaceFinishes.toString()}
        />
        <StatCard
          title="Top 3 Finishes"
          value={statistics.topThreeFinishes.toString()}
        />
      </div>
    </section>
  );
}

interface StatCardProps {
  title: string;
  value: string;
  subtitle?: string;
}

function StatCard({ title, value, subtitle }: StatCardProps) {
  return (
    <div className="flex flex-col gap-1 rounded-[14px] border bg-card p-4">
      <span className="text-[13px] font-semibold text-muted-foreground">{title}</span>
      <span className="font-score text-[38px] leading-none font-bold tabular-nums">{value}</span>
      {subtitle && <span className="text-xs text-muted-foreground">{subtitle}</span>}
    </div>
  );
}
