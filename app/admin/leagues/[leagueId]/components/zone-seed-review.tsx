'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ZoneBadge } from '@/components/zone-badge';
import { cn } from '@/lib/utils/utils';
import type { ZoneDefinition, ZoneSeedCandidate } from '@/lib/types/handicap';

export interface ReviewRow {
  candidate: ZoneSeedCandidate;
  /** The zone before any override. */
  fromCuts: number;
  zone: number;
  overridden: boolean;
  changed: boolean;
}

/** Every candidate with the zone the cuts give them, and a picker for one-off overrides. */
export function ZoneSeedReview({
  open,
  onOpenChange,
  rows,
  zones,
  onPick,
  onResetOverrides,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rows: ReviewRow[];
  zones: ZoneDefinition[];
  onPick: (playerId: string, zone: number) => void;
  onResetOverrides: () => void;
}) {
  const [filter, setFilter] = useState('');
  const [changedOnly, setChangedOnly] = useState(false);

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return rows
      .filter((row) => !changedOnly || row.changed)
      .filter((row) => !needle || row.candidate.player_name.toLowerCase().includes(needle))
      .sort((a, b) => b.candidate.history.points_per_match - a.candidate.history.points_per_match);
  }, [rows, filter, changedOnly]);

  const distanceOf = (zone: number) => zones.find((definition) => definition.zone === zone)?.distance_ft;
  const overrides = rows.filter((row) => row.overridden).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Review starting zones</DialogTitle>
          <DialogDescription>Pick a zone to override the cuts for one player. Overrides stay when the cuts move.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Input
            aria-label="Filter players"
            placeholder="Filter players"
            className="h-9 min-w-0 flex-1 basis-40"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
          <div className="flex items-center gap-2">
            <Switch id="zone-seed-changed" checked={changedOnly} onCheckedChange={setChangedOnly} />
            <Label htmlFor="zone-seed-changed" className="text-sm">Changed only</Label>
          </div>
          <Button size="sm" variant="outline" onClick={onResetOverrides} disabled={overrides === 0}>
            Reset overrides
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Player</TableHead>
                <TableHead>Points per match</TableHead>
                <TableHead className="hidden sm:table-cell">From cuts</TableHead>
                <TableHead>Starting zone</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map(({ candidate, fromCuts, zone, overridden }) => (
                <TableRow key={candidate.player_id} className={cn('border-muted', overridden && 'bg-primary/10 hover:bg-primary/15')}>
                  <TableCell className="whitespace-normal py-2">
                    <Link href={`/player/${candidate.player_number}`} className="font-semibold hover:underline">
                      {candidate.player_name}
                    </Link>
                  </TableCell>
                  <TableCell className="whitespace-normal py-2">
                    <span className="font-bold tabular-nums">{candidate.history.points_per_match.toFixed(1)}</span>{' '}
                    <span className="block text-xs text-muted-foreground tabular-nums sm:inline">
                      ({candidate.history.frames} frames, {candidate.history.events} {candidate.history.events === 1 ? 'event' : 'events'})
                    </span>
                    {!candidate.eligible && <span className="block text-xs text-muted-foreground sm:hidden">Too few putts</span>}
                  </TableCell>
                  <TableCell className="hidden py-2 sm:table-cell">
                    <div className="flex items-center gap-2">
                      <ZoneBadge zone={fromCuts} distanceFt={distanceOf(fromCuts)} size="sm" />
                      {!candidate.eligible && <span className="text-xs text-muted-foreground">Too few putts</span>}
                    </div>
                  </TableCell>
                  <TableCell className="py-2">
                    <Select value={String(zone)} onValueChange={(value) => onPick(candidate.player_id, Number(value))}>
                      <SelectTrigger className="h-8 w-28 sm:w-36" aria-label={`Starting zone for ${candidate.player_name}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {zones.map((definition) => (
                          <SelectItem key={definition.zone} value={String(definition.zone)}>
                            Zone {definition.zone} · {definition.distance_ft} ft
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                </TableRow>
              ))}
              {visible.length === 0 && (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={4} className="py-6 text-center text-sm text-muted-foreground">No players match.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
