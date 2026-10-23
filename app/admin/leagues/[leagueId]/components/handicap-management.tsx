'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { LeagueHandicapConfig, LeagueRosterEntry, ZoneSuggestion } from '@/lib/types/handicap';
import { HandicapSettingsForm } from './handicap-settings-form';
import { HandicapRoster, ZoneReviewQueue } from './handicap-roster';

/** The league's Handicaps tab: review queue (when non-empty), settings and roster. */
export function HandicapManagement({ leagueId }: { leagueId: string }) {
  const [config, setConfig] = useState<LeagueHandicapConfig | null>(null);
  const [roster, setRoster] = useState<LeagueRosterEntry[]>([]);
  const [suggestions, setSuggestions] = useState<ZoneSuggestion[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [settingsResponse, rosterResponse, suggestionsResponse] = await Promise.all([
        fetch(`/api/league/${leagueId}/handicap/settings`),
        fetch(`/api/league/${leagueId}/handicap/roster`),
        fetch(`/api/league/${leagueId}/handicap/suggestions`),
      ]);
      if (!settingsResponse.ok || !rosterResponse.ok || !suggestionsResponse.ok) {
        throw new Error('Failed to load handicaps');
      }
      setConfig(await settingsResponse.json());
      setRoster((await rosterResponse.json()).players);
      setSuggestions((await suggestionsResponse.json()).suggestions);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load handicaps');
    }
  }, [leagueId]);

  useEffect(() => {
    load();
  }, [load]);

  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!config) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading handicaps…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <ZoneReviewQueue
        leagueId={leagueId}
        suggestions={suggestions}
        demoteBelowPct={config.settings.demote_below_pct}
        onChanged={load}
      />
      <HandicapSettingsForm
        key={config.updated_at ?? 'defaults'}
        leagueId={leagueId}
        config={config}
        onSaved={(saved) => {
          setConfig(saved);
          load();
        }}
      />
      {config.configured && (
        <HandicapRoster leagueId={leagueId} roster={roster} zones={config.zones} onChanged={load} />
      )}
    </div>
  );
}
