'use client';

import { useState } from 'react';
import { Plus, Trash2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/use-toast';
import { zoneColorClass } from '@/components/zone-badge';
import { cn } from '@/lib/utils/utils';
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
    <section aria-labelledby="handicap-settings-heading" className="flex flex-col gap-4 rounded-2xl border bg-card p-5">
      <div className="flex flex-col gap-1">
        <h2 id="handicap-settings-heading" className="text-lg font-bold">Handicap settings</h2>
        <p className="text-xs text-muted-foreground">
          Players putt from their zone&apos;s distance. Zones change only when an event is completed or an
          organizer changes them. {settings.auto_demote_enabled
            ? 'This league moves players closer automatically below the demotion threshold.'
            : 'This league never moves anyone closer automatically: players below the demotion threshold are flagged for review.'}
        </p>
      </div>

      <SettingSwitch
        id="handicap-enabled"
        label="Use handicaps for new events"
        help="Applies to events created from now on. Events already created keep the setting they started with."
        checked={settings.enabled}
        onCheckedChange={(checked) => update('enabled', checked)}
      />
      <SettingSwitch
        id="auto-demote"
        label="Move players closer automatically"
        help="Off: players below the threshold are flagged for an organizer to review. If you turn this on, tell your players."
        checked={settings.auto_demote_enabled}
        onCheckedChange={(checked) => update('auto_demote_enabled', checked)}
      />
      <SettingSwitch
        id="count-qualification"
        label="Count qualification putts"
        help="Qualification rounds never count as matches."
        checked={settings.count_qualification_putts}
        onCheckedChange={(checked) => update('count_qualification_putts', checked)}
      />

      <div className="flex flex-col gap-2 border-t border-muted pt-3">
        <h3 className="text-sm font-semibold">Zones</h3>
        <p className="text-xs text-muted-foreground">
          The default distances each new event starts from. Organizers can adjust an event&apos;s distances for
          the night; the zone is what a player&apos;s record is kept against.
        </p>
        <div className="grid grid-cols-4 gap-1.5">
          {zones.map((zone) => (
            <label key={zone.zone} className="flex min-w-0 flex-col gap-1 text-xs font-bold">
              <span className={cn('w-fit rounded-[5px] px-1.5 py-0.5', zoneColorClass(zone.zone))}>Z{zone.zone}</span>
              <div className="relative">
                <Input
                  type="number"
                  inputMode="decimal"
                  step="0.5"
                  min="1"
                  className="h-10 pr-6 pl-2 text-sm md:text-sm"
                  aria-label={`Zone ${zone.zone} distance in feet`}
                  value={Number.isFinite(zone.distance_ft) ? zone.distance_ft : ''}
                  onChange={(e) => setZoneDistance(zone.zone, e.target.value)}
                />
                <span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-xs font-normal text-muted-foreground">
                  ft
                </span>
              </div>
            </label>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={addZone} disabled={zones.length >= MAX_ZONES}>
            <Plus className="mr-1 h-4 w-4" /> Add zone
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={removeLastZone} disabled={zones.length <= 2}>
            <Trash2 className="mr-1 h-4 w-4" /> Remove last zone
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 items-end gap-3">
        <SettingField id="promote-above" label="Move up above (%)">
          <Input
            id="promote-above"
            type="number"
            min={0}
            max={100}
            step="0.5"
            className="h-10"
            value={settings.promote_above_pct}
            onChange={(e) => update('promote_above_pct', Number(e.target.value))}
          />
        </SettingField>
        <SettingField id="demote-below" label="Flag below (%)">
          <Input
            id="demote-below"
            type="number"
            min={0}
            max={100}
            step="0.5"
            className="h-10"
            value={settings.demote_below_pct}
            onChange={(e) => update('demote_below_pct', Number(e.target.value))}
          />
        </SettingField>
        <SettingField id="min-putts" label="Minimum putts (0 = off)">
          <Input
            id="min-putts"
            type="number"
            min={0}
            className="h-10"
            value={settings.min_putts}
            onChange={(e) => update('min_putts', Number(e.target.value))}
          />
        </SettingField>
        <SettingField id="min-matches" label="…or minimum matches (0 = off)">
          <Input
            id="min-matches"
            type="number"
            min={0}
            className="h-10"
            value={settings.min_matches}
            onChange={(e) => update('min_matches', Number(e.target.value))}
          />
        </SettingField>
        <SettingField id="default-zone" label="Starting zone">
          <Input
            id="default-zone"
            type="number"
            min={1}
            max={zones.length}
            className="h-10"
            value={settings.default_zone}
            onChange={(e) => update('default_zone', Number(e.target.value))}
          />
        </SettingField>
        <SettingField id="window-putts" label="Most recent putts">
          <Input
            id="window-putts"
            type="number"
            min={1}
            placeholder="All"
            className="h-10"
            aria-describedby="window-putts-help"
            value={settings.window_putts ?? ''}
            onChange={(e) => update('window_putts', numberOrNull(e.target.value))}
          />
        </SettingField>
        <p id="window-putts-help" className="col-span-2 text-xs text-muted-foreground">
          The zone decision counts only the most recent putts: whole events, newest first. Leave it empty to use
          every putt since the player entered the zone.
        </p>
      </div>

      {validationError && <p className="text-sm text-destructive">{validationError}</p>}

      <Button onClick={save} disabled={saving || validationError !== null} className="w-full">
        {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Save settings
      </Button>
    </section>
  );
}

function SettingSwitch({
  id,
  label,
  help,
  checked,
  onCheckedChange,
}: {
  id: string;
  label: string;
  help: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex flex-col gap-0.5">
        <Label htmlFor={id} className="text-sm font-semibold">{label}</Label>
        <p className="text-xs text-muted-foreground">{help}</p>
      </div>
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={onCheckedChange}
        className="mt-0.5 data-[state=checked]:bg-success"
      />
    </div>
  );
}

function SettingField({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} className="text-[13px] font-semibold">{label}</Label>
      {children}
    </div>
  );
}
