'use client';

import { useState } from 'react';
import { Plus, Trash2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/use-toast';
import { ZoneBadge } from '@/components/zone-badge';
import { MAX_ZONES, type LeagueHandicapConfig, type ZoneDefinition } from '@/lib/types/handicap';
import { handicapSettingsError, zoneLadderError } from '@/lib/services/handicap/validation';

interface HandicapSettingsFormProps {
  leagueId: string;
  config: LeagueHandicapConfig;
  onSaved: (config: LeagueHandicapConfig) => void;
}

function numberOrNull(value: string): number | null {
  if (value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * League handicap settings: the toggle, thresholds, eligibility minimums, rolling
 * window and the nominal zone ladder. Editing the ladder changes what new events
 * start from; it never rewrites a player's record.
 */
export function HandicapSettingsForm({ leagueId, config, onSaved }: HandicapSettingsFormProps) {
  const [settings, setSettings] = useState(config.settings);
  const [zones, setZones] = useState<ZoneDefinition[]>(config.zones);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  const validationError = zoneLadderError(zones) ?? handicapSettingsError(settings, zones);

  const update = <K extends keyof typeof settings>(key: K, value: (typeof settings)[K]) =>
    setSettings((current) => ({ ...current, [key]: value }));

  const setZoneDistance = (zone: number, value: string) =>
    setZones((current) => current.map((z) => (z.zone === zone ? { ...z, distance_ft: Number(value) } : z)));

  const addZone = () =>
    setZones((current) => {
      const last = current[current.length - 1];
      return [...current, { zone: current.length + 1, distance_ft: (last?.distance_ft ?? 15) + 6 }];
    });

  const removeLastZone = () => setZones((current) => current.slice(0, -1));

  const save = async () => {
    setSaving(true);
    try {
      const response = await fetch(`/api/league/${leagueId}/handicap/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings, zones }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || 'Failed to save handicap settings');
      onSaved(data as LeagueHandicapConfig);
      toast({ title: 'Saved', description: 'Handicap settings updated' });
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to save handicap settings',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Handicap settings</CardTitle>
        <CardDescription>
          Players putt from their zone&apos;s distance. Zones change only when an event is completed or an
          organizer changes them. {settings.auto_demote_enabled
            ? 'This league moves players closer automatically below the demotion threshold.'
            : 'This league never moves anyone closer automatically: players below the demotion threshold are flagged for review.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <Label htmlFor="handicap-enabled">Use handicaps for new events</Label>
            <p className="text-xs text-muted-foreground">
              Applies to events created from now on. Events already created keep the setting they started with.
            </p>
          </div>
          <Switch
            id="handicap-enabled"
            checked={settings.enabled}
            onCheckedChange={(checked) => update('enabled', checked)}
          />
        </div>

        <section className="space-y-3">
          <h3 className="text-sm font-semibold">Zones</h3>
          <p className="text-xs text-muted-foreground">
            The default distances each new event starts from. Organizers can adjust an event&apos;s distances for
            the night; the zone is what a player&apos;s record is kept against.
          </p>
          <div className="space-y-2">
            {zones.map((zone) => (
              <div key={zone.zone} className="flex items-center gap-3">
                <ZoneBadge zone={zone.zone} distanceFt={null} className="w-20 justify-center" />
                <Input
                  type="number"
                  inputMode="decimal"
                  step="0.5"
                  min="1"
                  className="w-28"
                  aria-label={`Zone ${zone.zone} distance in feet`}
                  value={Number.isFinite(zone.distance_ft) ? zone.distance_ft : ''}
                  onChange={(e) => setZoneDistance(zone.zone, e.target.value)}
                />
                <span className="text-sm text-muted-foreground">ft</span>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" onClick={addZone} disabled={zones.length >= MAX_ZONES}>
              <Plus className="mr-1 h-4 w-4" /> Add zone
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={removeLastZone} disabled={zones.length <= 2}>
              <Trash2 className="mr-1 h-4 w-4" /> Remove last zone
            </Button>
          </div>
        </section>

        <section className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="default-zone">Starting zone for new players</Label>
            <Input
              id="default-zone"
              type="number"
              min={1}
              max={zones.length}
              value={settings.default_zone}
              onChange={(e) => update('default_zone', Number(e.target.value))}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="promote-above">Move up above (%)</Label>
            <Input
              id="promote-above"
              type="number"
              min={0}
              max={100}
              step="0.5"
              value={settings.promote_above_pct}
              onChange={(e) => update('promote_above_pct', Number(e.target.value))}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="demote-below">Flag for moving closer below (%)</Label>
            <Input
              id="demote-below"
              type="number"
              min={0}
              max={100}
              step="0.5"
              value={settings.demote_below_pct}
              onChange={(e) => update('demote_below_pct', Number(e.target.value))}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="window-putts">Count only the most recent putts</Label>
            <Input
              id="window-putts"
              type="number"
              min={1}
              placeholder="All putts in the zone"
              value={settings.window_putts ?? ''}
              onChange={(e) => update('window_putts', numberOrNull(e.target.value))}
            />
            <p className="text-xs text-muted-foreground">
              Whole events, newest first. Leave empty to use every putt since the player entered the zone.
            </p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="min-putts">Minimum putts before a move (0 = off)</Label>
            <Input
              id="min-putts"
              type="number"
              min={0}
              value={settings.min_putts}
              onChange={(e) => update('min_putts', Number(e.target.value))}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="min-matches">…or minimum matches (0 = off)</Label>
            <Input
              id="min-matches"
              type="number"
              min={0}
              value={settings.min_matches}
              onChange={(e) => update('min_matches', Number(e.target.value))}
            />
          </div>
        </section>

        <div className="flex items-center justify-between gap-4">
          <div>
            <Label htmlFor="count-qualification">Count qualification putts</Label>
            <p className="text-xs text-muted-foreground">Qualification rounds never count as matches.</p>
          </div>
          <Switch
            id="count-qualification"
            checked={settings.count_qualification_putts}
            onCheckedChange={(checked) => update('count_qualification_putts', checked)}
          />
        </div>

        <div className="flex items-center justify-between gap-4">
          <div>
            <Label htmlFor="auto-demote">Move players closer automatically</Label>
            <p className="text-xs text-muted-foreground">
              Off: players below the threshold are flagged for an organizer to review. If you turn this on, tell
              your players.
            </p>
          </div>
          <Switch
            id="auto-demote"
            checked={settings.auto_demote_enabled}
            onCheckedChange={(checked) => update('auto_demote_enabled', checked)}
          />
        </div>

        {validationError && <p className="text-sm text-destructive">{validationError}</p>}

        <Button onClick={save} disabled={saving || validationError !== null}>
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Save handicap settings
        </Button>
      </CardContent>
    </Card>
  );
}
