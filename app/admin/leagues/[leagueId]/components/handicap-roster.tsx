'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';
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
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import { ZoneBadge } from '@/components/zone-badge';
import { eligibilityText, formatPct, formatPeriodStats, formatTimestampDate } from '@/lib/utils/handicap-format';
import type { LeagueRosterEntry, ZoneDefinition, ZoneSuggestion } from '@/lib/types/handicap';

async function postJson(url: string, body: unknown): Promise<void> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data?.error || 'Request failed');
  }
}

/**
 * Open demotion suggestions, pinned above the roster. The counterweight to "no
 * automatic demotion": the system does the noticing, an organizer decides.
 */
export function ZoneReviewQueue({
  leagueId,
  suggestions,
  demoteBelowPct,
  onChanged,
}: {
  leagueId: string;
  suggestions: ZoneSuggestion[];
  demoteBelowPct: number;
  onChanged: () => void;
}) {
  const [dismissing, setDismissing] = useState<ZoneSuggestion | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const { toast } = useToast();

  if (suggestions.length === 0) return null;

  const resolve = async (suggestion: ZoneSuggestion, action: 'apply' | 'dismiss', resolutionNote: string | null) => {
    setBusy(suggestion.evaluation_id);
    try {
      await postJson(`/api/league/${leagueId}/handicap/suggestions/${suggestion.evaluation_id}`, {
        action,
        note: resolutionNote,
      });
      toast({
        title: action === 'apply' ? 'Zone changed' : 'Suggestion dismissed',
        description: action === 'apply'
          ? `${suggestion.player_name} moves to Zone ${suggestion.zone - 1} from the next event`
          : `${suggestion.player_name} stays in Zone ${suggestion.zone}`,
      });
      setDismissing(null);
      setNote('');
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to resolve suggestion',
        variant: 'destructive',
      });
    } finally {
      setBusy(null);
      onChanged();
    }
  };

  return (
    <Card className="border-amber-500/60">
      <CardHeader>
        <CardTitle>
          {suggestions.length} {suggestions.length === 1 ? 'player' : 'players'} below {demoteBelowPct}% at their zone
        </CardTitle>
        <CardDescription>
          Nobody is moved closer automatically. Move them, or dismiss with a note; a player who stays low is flagged
          again after their next event.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {suggestions.map((suggestion) => (
          <div
            key={suggestion.evaluation_id}
            className="flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <Link href={`/player/${suggestion.player_number}`} className="font-medium hover:underline">
                  {suggestion.player_name}
                </Link>
                <ZoneBadge zone={suggestion.zone} distanceFt={suggestion.distance_ft} size="sm" />
              </div>
              <p className="text-sm">
                {formatPct(suggestion.stats.make_pct)} over {suggestion.stats.putts_attempted} putts since{' '}
                {formatTimestampDate(suggestion.period_started_at)}
              </p>
              {suggestion.previous_flags > 0 && (
                <p className="text-xs text-muted-foreground">
                  Flagged {suggestion.previous_flags} {suggestion.previous_flags === 1 ? 'time' : 'times'} before
                </p>
              )}
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() => resolve(suggestion, 'apply', null)}
                disabled={busy !== null}
              >
                {busy === suggestion.evaluation_id && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
                Move to Zone {suggestion.zone - 1}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setDismissing(suggestion)} disabled={busy !== null}>
                Dismiss
              </Button>
            </div>
          </div>
        ))}
      </CardContent>

      <Dialog open={dismissing !== null} onOpenChange={(open) => !open && setDismissing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Keep {dismissing?.player_name} in Zone {dismissing?.zone}?</DialogTitle>
            <DialogDescription>Add a note for the other organizers. Players never see it.</DialogDescription>
          </DialogHeader>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why they stay" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setDismissing(null)}>Cancel</Button>
            <Button
              onClick={() => dismissing && resolve(dismissing, 'dismiss', note)}
              disabled={!note.trim() || busy !== null}
            >
              Dismiss suggestion
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

/** Players with an entry in the league: zone, period stats, eligibility, and a manual change. */
export function HandicapRoster({
  leagueId,
  roster,
  zones,
  onChanged,
}: {
  leagueId: string;
  roster: LeagueRosterEntry[];
  zones: ZoneDefinition[];
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState<LeagueRosterEntry | null>(null);
  const [zone, setZone] = useState<string>('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  const openEditor = (entry: LeagueRosterEntry) => {
    setEditing(entry);
    setZone(entry.zone !== null ? String(entry.zone) : '');
    setNote('');
  };

  const save = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      await postJson(`/api/league/${leagueId}/players/${editing.player_id}/zone`, { zone: Number(zone), note });
      toast({ title: 'Zone changed', description: `${editing.player_name} is in Zone ${zone} from the next event` });
      setEditing(null);
      onChanged();
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to change zone',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Players</CardTitle>
        <CardDescription>
          Everyone who has played in this league. A zone change applies from the next event the player plays.
        </CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        {roster.length === 0 ? (
          <p className="text-sm text-muted-foreground">No players have played in this league yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Player</TableHead>
                <TableHead>Zone</TableHead>
                <TableHead>Current period</TableHead>
                <TableHead>Eligibility</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {roster.map((entry) => (
                <TableRow key={entry.player_id}>
                  <TableCell>
                    <Link href={`/player/${entry.player_number}`} className="font-medium hover:underline">
                      {entry.player_name}
                    </Link>
                    {entry.has_open_suggestion && (
                      <span className="ml-2 text-xs text-amber-600">flagged</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {entry.zone !== null ? (
                      <ZoneBadge zone={entry.zone} distanceFt={entry.distance_ft} size="sm" />
                    ) : (
                      <span className="text-xs text-muted-foreground">No zone yet</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm tabular-nums">
                    {entry.stats && entry.stats.putts_attempted > 0 ? formatPeriodStats(entry.stats) : '–'}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {entry.progress ? eligibilityText(entry.progress) ?? 'Eligible' : '–'}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="outline" onClick={() => openEditor(entry)}>
                      Change zone
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change zone for {editing?.player_name}</DialogTitle>
            <DialogDescription>
              Applies from the next event. Their history will say an organizer moved them; the note is visible to
              organizers only.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Zone</Label>
              <Select value={zone} onValueChange={setZone}>
                <SelectTrigger aria-label="Zone">
                  <SelectValue placeholder="Choose a zone" />
                </SelectTrigger>
                <SelectContent>
                  {zones.map((definition) => (
                    <SelectItem key={definition.zone} value={String(definition.zone)}>
                      Zone {definition.zone} · {definition.distance_ft} ft
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="zone-note">Note (required)</Label>
              <Textarea id="zone-note" value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button
              onClick={save}
              disabled={saving || !note.trim() || !zone || Number(zone) === editing?.zone}
            >
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Change zone
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
