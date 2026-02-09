'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Statistics</h2>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
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
      </div>

      <div className="grid grid-cols-2 gap-4">
        <StatCard
          title="1st Place Finishes"
          value={statistics.firstPlaceFinishes.toString()}
        />
        <StatCard
          title="Top 3 Finishes"
          value={statistics.topThreeFinishes.toString()}
        />
      </div>
    </div>
  );
}

interface StatCardProps {
  title: string;
  value: string;
  subtitle?: string;
}

function StatCard({ title, value, subtitle }: StatCardProps) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        {subtitle && (
          <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
        )}
      </CardContent>
    </Card>
  );
}
