'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Status } from 'brackets-model';
import { ArrowLeftRight, ChevronDown, Loader2, RotateCcw, SquarePlus, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { PlayerPicker, type PickedPlayer } from '@/components/player-picker';
import { ZoneBadge } from '@/components/zone-badge';
import { buildMatchNumbers, isHiddenMatch } from '@/lib/brackets/match-numbering';
import { cn } from '@/lib/utils/utils';
import type { BracketWithTeams } from '@/lib/types/bracket';
import type { EventWithDetails } from '@/lib/types/event';
import type { PaymentType } from '@/lib/types/player';
import { useRequiredEventBracket } from './event-bracket-context';
import { PaymentToggle, SubstituteDialog, fetchZonePreview, type ZonePreview } from './substitute-dialog';

interface ByeClosingMatch {
  matchId: number;
  kind: 'starts' | 'finishes';
  status: number;
  laneLabel: string | null;
  framesPlayed: number;
  participantIds: Array<number | null>;
}

interface OpenBye {
  byeMatchId: number;
  participantId: number;
  teamId: string | null;
  seed: number | null;
  open: boolean;
  closedReason: string | null;
  closesWhen: ByeClosingMatch | null;
  held: boolean;
}

interface ByesSummary {
  byes: OpenBye[];
  defaultByeMatchId: number | null;
  frameCount: number;
}

async function readError(response: Response, fallback: string) {
  try {
    return (await response.json())?.error || fallback;
  } catch {
    return fallback;
  }
}

/** Round 1 byes for the event, refetched whenever the bracket changes. */
function useByes(eventId: string, bracketData: BracketWithTeams | null) {
  const [summary, setSummary] = useState<ByesSummary | null>(null);
  const load = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch(`/api/event/${eventId}/bracket/byes`, { signal });
    if (!response.ok || signal?.aborted) return;
    setSummary(await response.json());
  }, [eventId]);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal).catch(() => {});
    return () => controller.abort();
  }, [load, bracketData]);
  return { summary, setSummary, reload: load };
}

function seedLabel(bracket: BracketWithTeams, participantId: number | null): string {
  if (participantId == null) return 'TBD';
  const team = bracket.participantTeamMap[participantId];
  return team ? `Seed ${team.seed}` : 'TBD';
}

function closingText(bracket: BracketWithTeams, closing: ByeClosingMatch, frameCount: number, numbers: Map<number, number>) {
  const [a, b] = closing.participantIds.map((id) => seedLabel(bracket, id));
  const number = numbers.get(closing.matchId);
  const title = `Closes when ${number ? `M${number} ` : ''}(${a} vs ${b}) ${closing.kind === 'starts' ? 'starts' : 'finishes'}`;
  const where = closing.status === Status.Running
    ? `${closing.laneLabel ? `Lane ${closing.laneLabel} · ` : ''}frame ${Math.min(closing.framesPlayed + 1, frameCount)} of ${frameCount}`
    : closing.laneLabel
      ? `On lane ${closing.laneLabel}, not started`
      : closing.participantIds.every((id) => id != null)
        ? 'Waiting for a lane'
        : 'Waiting for an earlier match';
  return { title, where };
}

/**
 * "Missed a player?" on the admin Bracket tab (mockup 2A): substitute, fill an open bye,
 * or reopen registration, with whether each is possible right now and why.
 */
export function MissedPlayerMenu({ event, onEventChanged }: { event: EventWithDetails; onEventChanged: () => void }) {
  const { bracketData, refresh } = useRequiredEventBracket();
  const { summary, reload } = useByes(event.id, bracketData);
  const [dialog, setDialog] = useState<'substitute' | 'fill' | 'reopen' | null>(null);

  const scoringStarted = useMemo(() => (bracketData?.bracket.matches ?? []).some((match) =>
    match.status === Status.Running ||
    (match.status === Status.Completed && !isHiddenMatch(match))
  ), [bracketData]);
  const openByes = summary?.byes.filter((bye) => bye.open) ?? [];
  const teamCount = event.teams?.length ?? 0;

  const byeStatus = !summary
    ? 'Checking byes…'
    : summary.byes.length === 0
      ? `Not available · ${teamCount} teams, no byes`
      : openByes.length === 0
        ? `Not available · ${summary.byes.length === 1 ? 'the bye has' : `all ${summary.byes.length} byes have`} closed`
        : `Available · ${openByes.length} open bye${openByes.length === 1 ? '' : 's'}`;

  const done = () => {
    refresh();
    onEventChanged();
    void reload();
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm">
            <UserPlus className="mr-2 h-4 w-4" />
            Missed a player?
            <ChevronDown className="ml-1.5 h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-[400px] p-1.5">
          <MenuOption
            icon={<ArrowLeftRight className="size-[18px]" />}
            title="Substitute a player"
            detail="Swap the floater (or anyone) out between matches. The new player putts from their own zone."
            status={teamCount > 0 ? 'Available · between a team’s matches' : 'Not available · no teams'}
            available={teamCount > 0}
            onSelect={() => setDialog('substitute')}
          />
          <MenuOption
            icon={<SquarePlus className="size-[18px]" />}
            title="Add a team into an open bye"
            detail={`Needs a full team${event.team_size === 2 ? ' (usually the missed player and the floater)' : ''}. Only for a bye whose next match hasn't started.`}
            status={byeStatus}
            available={openByes.length > 0}
            onSelect={() => setDialog('fill')}
          />
          <MenuOption
            icon={<RotateCcw className="size-[18px]" />}
            title="Reopen registration"
            detail="Undo the bracket, add the player, draw again. Only while no frames are scored."
            status={scoringStarted ? 'Not available · scoring has started' : 'Available · no frames scored'}
            available={!scoringStarted}
            onSelect={() => setDialog('reopen')}
          />
        </DropdownMenuContent>
      </DropdownMenu>

      <SubstituteDialog
        event={event}
        team={null}
        teams={event.teams ?? []}
        open={dialog === 'substitute'}
        onOpenChange={(open) => setDialog(open ? 'substitute' : null)}
        onDone={done}
      />
      {bracketData && (
        <FillByeDialog
          event={event}
          bracket={bracketData}
          summary={summary}
          onSummary={reload}
          open={dialog === 'fill'}
          onOpenChange={(open) => setDialog(open ? 'fill' : null)}
          onDone={done}
        />
      )}
      <ReopenRegistrationDialog
        event={event}
        open={dialog === 'reopen'}
        onOpenChange={(open) => setDialog(open ? 'reopen' : null)}
        onDone={onEventChanged}
      />
    </>
  );
}

function MenuOption({
  icon,
  title,
  detail,
  status,
  available,
  onSelect,
}: {
  icon: React.ReactNode;
  title: string;
  detail: string;
  status: string;
  available: boolean;
  onSelect: () => void;
}) {
  return (
    <DropdownMenuItem disabled={!available} onSelect={onSelect} className="items-start gap-3 rounded-[10px] p-3 data-[disabled]:opacity-100">
      <span
        className={cn(
          'inline-flex size-[34px] flex-none items-center justify-center rounded-[9px]',
          available ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
        )}
        aria-hidden="true"
      >
        {icon}
      </span>
      <span className={cn('flex flex-col gap-[3px]', !available && 'opacity-60')}>
        <span className="text-[15px] font-bold">{title}</span>
        <span className="text-[13px] leading-[1.4] text-muted-foreground">{detail}</span>
        <span className={cn('text-xs font-bold', available ? 'text-success' : 'text-muted-foreground')}>{status}</span>
      </span>
    </DropdownMenuItem>
  );
}

/** Enter a new team into a Round 1 bye (mockup 2E). */
function FillByeDialog({
  event,
  bracket,
  summary,
  onSummary,
  open,
  onOpenChange,
  onDone,
}: {
  event: EventWithDetails;
  bracket: BracketWithTeams;
  summary: ByesSummary | null;
  onSummary: () => Promise<void>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const size = event.team_size;
  const [byeId, setByeId] = useState<number | null>(null);
  const [players, setPlayers] = useState<Array<PickedPlayer | null>>([]);
  const [payments, setPayments] = useState<Array<PaymentType | null>>([]);
  const [zones, setZones] = useState<Map<string, ZonePreview>>(new Map());
  const [saving, setSaving] = useState(false);
  const [holding, setHolding] = useState(false);
  // Shown at once; the summary catches up after the server answers.
  const [heldOverride, setHeldOverride] = useState<boolean | null>(null);
  const numbers = useMemo(
    () => buildMatchNumbers(bracket.bracket.groups, bracket.bracket.rounds, bracket.bracket.matches as never),
    [bracket]
  );

  useEffect(() => {
    if (!open) return;
    setByeId(summary?.defaultByeMatchId ?? null);
    setPlayers(Array.from({ length: size }, () => null));
    setPayments(Array.from({ length: size }, () => 'cash'));
    setZones(new Map());
    // Only on open: later summary refreshes must not override the organizer's choice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, size]);

  const picked = players.filter((p): p is PickedPlayer => p !== null);
  const pickedKey = picked.map((p) => p.id).join(',');
  useEffect(() => {
    if (!pickedKey) return;
    let cancelled = false;
    void fetchZonePreview(event.id, pickedKey.split(',')).then((map) => {
      if (!cancelled) setZones(map);
    });
    return () => {
      cancelled = true;
    };
  }, [event.id, pickedKey]);

  const bye = summary?.byes.find((b) => b.byeMatchId === byeId) ?? null;
  const byeTeam = bye ? seedLabel(bracket, bye.participantId) : null;
  const newSeed = (event.teams?.length ?? 0) + 1;
  const closing = bye?.closesWhen ? closingText(bracket, bye.closesWhen, summary?.frameCount ?? 5, numbers) : null;

  const toggleHold = async (hold: boolean) => {
    if (!bye) return;
    try {
      setHolding(true);
      setHeldOverride(hold);
      const response = await fetch(`/api/event/${event.id}/bracket/byes/hold`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bye_match_id: bye.byeMatchId, hold }),
      });
      if (!response.ok) throw new Error(await readError(response, 'Could not change the hold'));
      await onSummary();
    } catch (error) {
      toast({ title: 'Hold not changed', description: error instanceof Error ? error.message : undefined, variant: 'destructive' });
    } finally {
      setHeldOverride(null);
      setHolding(false);
    }
  };

  const submit = async () => {
    if (!bye || picked.length !== size) return;
    try {
      setSaving(true);
      const response = await fetch(`/api/event/${event.id}/bracket/fill-bye`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bye_match_id: bye.byeMatchId, player_ids: picked.map((p) => p.id), payments }),
      });
      if (!response.ok) throw new Error(await readError(response, 'Could not fill the bye'));
      const data: { seed: number } = await response.json();
      toast({ title: `Seed ${data.seed} is in`, description: `${byeTeam} now plays them in Round 1.` });
      onOpenChange(false);
      onDone();
    } catch (error) {
      toast({ title: 'Bye not filled', description: error instanceof Error ? error.message : undefined, variant: 'destructive' });
      void onSummary();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-[520px]">
        <DialogHeader className="gap-1 px-5 pt-[22px] pb-3 pr-14 text-left sm:px-6">
          <DialogTitle className="text-[22px] font-bold">Add a team into a bye</DialogTitle>
          <DialogDescription>
            The team with the bye plays the new team in Round 1 instead of waiting.
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto px-5 pb-4 sm:px-6">
          <div className="flex flex-col gap-1.5">
            <label className="text-[13px] font-semibold" htmlFor="fill-bye">Open bye</label>
            <Select value={byeId != null ? String(byeId) : undefined} onValueChange={(value) => setByeId(Number(value))}>
              <SelectTrigger id="fill-bye" className="h-11"><SelectValue placeholder="Choose a bye" /></SelectTrigger>
              <SelectContent>
                {(summary?.byes ?? []).map((b) => (
                  <SelectItem key={b.byeMatchId} value={String(b.byeMatchId)} disabled={!b.open}>
                    vs {seedLabel(bracket, b.participantId)} · {b.open ? 'Round 1' : 'closed'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {bye?.open && (
            <div className="flex flex-col gap-2 rounded-[10px] border border-warning/40 bg-warning/10 px-3 py-2.5">
              {closing ? (
                <>
                  <span className="text-[13px] font-bold">{closing.title}</span>
                  <span className="text-xs text-muted-foreground">{closing.where}</span>
                </>
              ) : (
                <span className="text-[13px] font-bold">Closes when {byeTeam}&apos;s next match starts</span>
              )}
              <label className="flex cursor-pointer items-center gap-2 text-[13px] font-semibold">
                <input
                  type="checkbox"
                  className="size-[18px] accent-primary"
                  checked={heldOverride ?? bye.held}
                  disabled={holding}
                  onChange={(e) => void toggleHold(e.target.checked)}
                />
                Hold {byeTeam}&apos;s next match until I decide
              </label>
            </div>
          )}

          <div className="flex flex-col gap-3">
            <span className="text-[13px] font-semibold">New team</span>
            {players.map((player, i) => (
              <div key={i} className="flex flex-col gap-2 rounded-[10px] border p-3">
                <PlayerPicker
                  eventId={event.id}
                  id={`fill-player-${i}`}
                  label={size === 1 ? 'Player' : `Player ${i + 1}`}
                  value={player}
                  exclude={picked.map((p) => p.id)}
                  onChange={(next) => setPlayers(players.map((p, j) => (j === i ? next : p)))}
                />
                {player && zones.get(player.id)?.zone != null && (
                  <div className="flex justify-end">
                    <ZoneBadge zone={zones.get(player.id)!.zone} distanceFt={zones.get(player.id)!.putt_distance_ft} />
                  </div>
                )}
                {player && (
                  <PaymentToggle
                    legend={`${player.full_name.split(' ')[0]} paid`}
                    value={payments[i] ?? null}
                    onChange={(value) => setPayments(payments.map((p, j) => (j === i ? value : p)))}
                  />
                )}
              </div>
            ))}
          </div>

          {bye && (
            <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-[13px] leading-[1.45] text-muted-foreground">
              <li>Joins as seed {newSeed}. {byeTeam} plays Round 1 instead of waiting.</li>
              <li>Announced match numbers don&apos;t change; the new matches are numbered last.</li>
              {event.team_size === 2 && event.team_assignment === 'random_pairing' && (
                <li>The higher-scoring player takes the Pool A slot.</li>
              )}
            </ul>
          )}
        </div>

        <DialogFooter className="gap-2.5 border-t px-5 py-4 sm:px-6">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={submit} disabled={saving || !bye?.open || picked.length !== size}>
            {saving && <Loader2 className="mr-2 size-4 animate-spin" />}
            {bye ? `Add team vs ${byeTeam}` : 'Add team'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Take the event back to registration while nothing is scored (mockup 2B). */
function ReopenRegistrationDialog({
  event,
  open,
  onOpenChange,
  onDone,
}: {
  event: EventWithDetails;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [keepTeams, setKeepTeams] = useState(true);
  const [saving, setSaving] = useState(false);
  const teamCount = event.teams?.length ?? 0;

  const submit = async () => {
    try {
      setSaving(true);
      const response = await fetch(`/api/event/${event.id}/reopen-registration`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keep_teams: keepTeams }),
      });
      if (!response.ok) throw new Error(await readError(response, 'Could not reopen registration'));
      toast({ title: 'Registration reopened', description: 'Add the missed player, then start bracket play again.' });
      onOpenChange(false);
      onDone();
    } catch (error) {
      toast({ title: 'Not reopened', description: error instanceof Error ? error.message : undefined, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const option = (value: boolean, title: string, detail: string) => (
    <label className={cn('flex cursor-pointer gap-3 rounded-[10px] border px-3 py-2.5', keepTeams === value && 'border-primary bg-muted/50')}>
      <input type="radio" name="reopen-teams" className="mt-0.5 size-4 accent-primary" checked={keepTeams === value} onChange={() => setKeepTeams(value)} />
      <span className="flex flex-col gap-0.5">
        <span className="text-[15px] font-semibold">{title}</span>
        <span className="text-[13px] text-muted-foreground">{detail}</span>
      </span>
    </label>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader className="text-left">
          <DialogTitle className="text-[22px] font-bold">Reopen registration?</DialogTitle>
          <DialogDescription>
            The event goes back to Registration so you can add the missed player, then you start the bracket again.
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-[10px] bg-success/10 px-3 py-2 text-sm font-semibold text-success">
          No frames have been scored in any match
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-semibold">What happens</span>
          <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-[13px] leading-[1.45] text-muted-foreground">
            <li>The bracket and lane assignments are removed. The public bracket is hidden until it starts again.</li>
            <li>Players, payments, zones and qualification scores are kept.</li>
            <li>The second chance is untouched (nobody has been knocked out yet).</li>
          </ul>
        </div>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1.5 text-[13px] font-semibold">Teams</legend>
          {option(true, `Keep the ${teamCount} teams already announced`, 'Only the new players are paired. Seeds are recalculated.')}
          {option(false, 'Draw all teams again', 'Pools are recomputed with everyone. Announced partners may change.')}
        </fieldset>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>
            {saving && <Loader2 className="mr-2 size-4 animate-spin" />}
            Reopen registration
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
