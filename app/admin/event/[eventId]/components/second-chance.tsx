'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertTriangle, ArrowRight, Loader2, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/use-toast';
import { BRACKET_FORMATS, type BracketFormat } from '@/lib/brackets/format';
import { BRACKET_FORMAT_LABELS } from '@/lib/utils/bracket-format';
import type { LaneWithMatch } from '@/lib/types/bracket';
import type {
  EventStatus,
  EventWithDetails,
  SecondChanceRoster,
  SecondChanceSummary,
} from '@/lib/types/event';

const STATUS_LABELS: Record<EventStatus, string> = {
  created: 'Created',
  'pre-bracket': 'Taking entries',
  bracket: 'Bracket play',
  completed: 'Completed',
};

function generateAccessCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

async function readJson<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((data as { error?: string })?.error || 'Request failed');
  return data as T;
}

function CreateSecondChanceDialog({
  event,
  open,
  onOpenChange,
}: {
  event: EventWithDetails;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [accessCode, setAccessCode] = useState(generateAccessCode);
  const [format, setFormat] = useState<BracketFormat>('single_elimination');
  const [extraMatch, setExtraMatch] = useState(false);
  const [entryFee, setEntryFee] = useState('');
  const [lanes, setLanes] = useState<LaneWithMatch[] | null>(null);
  const [laneIds, setLaneIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetch(`/api/event/${event.id}/lanes`)
      .then((response) => readJson<LaneWithMatch[]>(response))
      .then((data) => { if (!cancelled) setLanes(data); })
      .catch(() => { if (!cancelled) setLanes([]); });
    return () => { cancelled = true; };
  }, [open, event.id]);

  const toggleLane = (laneId: string) =>
    setLaneIds((current) => current.includes(laneId) ? current.filter((id) => id !== laneId) : [...current, laneId]);
  const busyPicked = lanes?.filter((lane) => laneIds.includes(lane.id) && lane.status === 'occupied') ?? [];

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      const created = await readJson<{ id: string }>(await fetch(`/api/event/${event.id}/second-chance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          access_code: accessCode,
          lane_ids: laneIds,
          bracket_format: format,
          double_grand_final: format === 'double_elimination' && extraMatch,
          third_place_match: format === 'single_elimination' && extraMatch,
          entry_fee_per_player: entryFee === '' ? null : Number(entryFee),
        }),
      }));
      onOpenChange(false);
      router.push(`/admin/event/${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create the second chance');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Create second chance</DialogTitle>
          <DialogDescription>
            A singles bracket for players knocked out of this event. Players knocked out later can be
            added until its bracket starts. It plays on lanes it borrows from this event.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="sc-format">Bracket format</Label>
            <Select
              value={format}
              onValueChange={(value) => {
                setFormat(value as BracketFormat);
                setExtraMatch(value === 'double_elimination');
              }}
              disabled={saving}
            >
              <SelectTrigger id="sc-format" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {BRACKET_FORMATS.map((option) => (
                  <SelectItem key={option} value={option}>{BRACKET_FORMAT_LABELS[option]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between gap-3 rounded-xl bg-muted px-3.5 py-3">
            <div className="flex flex-col gap-0.5">
              <Label htmlFor="sc-extra">{format === 'single_elimination' ? 'Third-place match' : 'Grand final reset'}</Label>
              <span className="text-xs text-muted-foreground">
                {format === 'single_elimination'
                  ? 'Semifinal losers play for 3rd'
                  : 'WB champion must lose twice in the grand final'}
              </span>
            </div>
            <Switch id="sc-extra" checked={extraMatch} onCheckedChange={setExtraMatch} disabled={saving} />
          </div>

          <div className="grid gap-1.5">
            <Label id="sc-lanes-label">Lanes</Label>
            {lanes === null ? (
              <span className="text-sm text-muted-foreground">Loading lanes…</span>
            ) : lanes.length === 0 ? (
              <span className="text-sm text-muted-foreground">This event has no lanes to lend.</span>
            ) : (
              <div role="group" aria-labelledby="sc-lanes-label" className="flex flex-wrap gap-2">
                {lanes.map((lane) => {
                  const picked = laneIds.includes(lane.id);
                  const unavailable = lane.status === 'maintenance' || lane.maintenance_pending;
                  return (
                    <Button
                      key={lane.id}
                      type="button"
                      size="sm"
                      variant={picked ? 'default' : 'outline'}
                      aria-pressed={picked}
                      onClick={() => toggleLane(lane.id)}
                      disabled={saving || unavailable}
                      title={unavailable ? 'In maintenance' : lane.status === 'occupied' ? 'In use: moves once its match is done' : undefined}
                    >
                      {lane.label}
                      {lane.status === 'occupied' && <span className="text-xs opacity-75">· in use</span>}
                    </Button>
                  );
                })}
              </div>
            )}
            <span className="text-xs text-muted-foreground">
              {busyPicked.length > 0
                ? `${busyPicked.map((lane) => lane.label).join(', ')} ${busyPicked.length === 1 ? 'finishes its' : 'finish their'} current match first, then ${busyPicked.length === 1 ? 'moves' : 'move'} over. No new main-event match goes there.`
                : 'You can lend or return lanes later from either event\'s lanes.'}
            </span>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="sc-fee">Entry fee (optional)</Label>
            <Input
              id="sc-fee"
              type="number"
              min={0}
              step="0.01"
              value={entryFee}
              onChange={(e) => setEntryFee(e.target.value)}
              disabled={saving}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="sc-code">Access code</Label>
            <div className="flex gap-2">
              <Input
                id="sc-code"
                value={accessCode}
                onChange={(e) => setAccessCode(e.target.value)}
                disabled={saving}
                className="font-mono"
              />
              <Button type="button" variant="outline" onClick={() => setAccessCode(generateAccessCode())} disabled={saving}>
                Generate
              </Button>
            </div>
            <span className="text-xs text-muted-foreground">Scorers use this code, not the main event&apos;s.</span>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={submit} disabled={saving || accessCode.trim().length < 6}>
            {saving && <Loader2 className="size-4 animate-spin" />}
            Create second chance
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** On a main event in bracket play or completed: create its second chance, or open it. */
export function SecondChancePanel({ event }: { event: EventWithDetails }) {
  const [summary, setSummary] = useState<SecondChanceSummary | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/event/${event.id}/second-chance`)
      .then((response) => readJson<SecondChanceSummary>(response))
      .then((data) => { if (!cancelled) setSummary(data); })
      .catch(() => { if (!cancelled) setSummary(null); });
    return () => { cancelled = true; };
  }, [event.id, event.status]);

  if (!summary || (!summary.child && !summary.can_create)) return null;

  const knockedOut = `${summary.eliminated_count} player${summary.eliminated_count === 1 ? '' : 's'}`;
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0">
        <div className="space-y-1">
          <CardTitle>Second chance</CardTitle>
          <CardDescription>
            {summary.child
              ? `${STATUS_LABELS[summary.child.status]} · ${knockedOut} ${event.status === 'completed' ? 'eligible' : 'knocked out so far'}`
              : `${knockedOut} ${event.status === 'completed' ? 'eligible' : 'knocked out so far'}. Late knockouts can be added until its bracket starts.`}
          </CardDescription>
        </div>
        {summary.child ? (
          <Button asChild variant="outline">
            <Link href={`/admin/event/${summary.child.id}`}>
              Open second chance
              <ArrowRight className="size-4" />
            </Link>
          </Button>
        ) : (
          <Button onClick={() => setDialogOpen(true)}>Create second chance</Button>
        )}
      </CardHeader>
      {summary.can_create && (
        <CreateSecondChanceDialog event={event} open={dialogOpen} onOpenChange={setDialogOpen} />
      )}
    </Card>
  );
}

/** On a second-chance event: link back to the main event, and add players as they are knocked out. */
export function SecondChanceRosterPanel({
  event,
  onPlayersAdded,
}: {
  event: EventWithDetails;
  onPlayersAdded: () => void;
}) {
  const { toast } = useToast();
  const [roster, setRoster] = useState<SecondChanceRoster | null>(null);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async () => {
    try {
      setRoster(await readJson<SecondChanceRoster>(await fetch(`/api/event/${event.id}/second-chance/roster`)));
    } catch {
      setRoster(null);
    }
  }, [event.id]);

  useEffect(() => {
    load();
  }, [load, event.status, event.players.length]);

  const sync = async () => {
    setSyncing(true);
    try {
      const result = await readJson<SecondChanceRoster & { added: number }>(
        await fetch(`/api/event/${event.id}/second-chance/roster`, { method: 'POST' })
      );
      setRoster(result);
      toast({ title: `Added ${result.added} player${result.added === 1 ? '' : 's'}` });
      onPlayersAdded();
    } catch (err) {
      toast({ title: 'Error', description: err instanceof Error ? err.message : 'Failed to add players' });
    } finally {
      setSyncing(false);
    }
  };

  if (!event.parent_event_id) return null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0">
        <div className="space-y-1">
          <CardTitle>Second chance</CardTitle>
          <CardDescription>
            For players knocked out of the{' '}
            <Link href={`/admin/event/${event.parent_event_id}`} className="text-info underline-offset-4 hover:underline">
              main event
            </Link>
            {roster?.parent_status === 'bracket' ? ', which is still in bracket play.' : '.'}
          </CardDescription>
        </div>
        {roster?.can_sync && (
          <Button onClick={sync} disabled={syncing || roster.pending.length === 0}>
            {syncing ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" />}
            {roster.pending.length === 0
              ? 'No new knockouts'
              : `Add ${roster.pending.length} knocked-out player${roster.pending.length === 1 ? '' : 's'}`}
          </Button>
        )}
      </CardHeader>
      {roster?.can_sync && (roster.pending.length > 0 || roster.not_eliminated.length > 0) && (
        <CardContent className="space-y-3 text-sm">
          {roster.pending.length > 0 && (
            <p>
              <span className="text-muted-foreground">Knocked out, not entered yet: </span>
              {roster.pending.map((player) => player.full_name).join(', ')}
            </p>
          )}
          {roster.not_eliminated.length > 0 && (
            <p className="flex items-start gap-2 text-warning">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span>
                Entered but still alive in the main event: {roster.not_eliminated.map((player) => player.full_name).join(', ')}.
                Remove them below if they shouldn&apos;t play.
              </span>
            </p>
          )}
        </CardContent>
      )}
    </Card>
  );
}
