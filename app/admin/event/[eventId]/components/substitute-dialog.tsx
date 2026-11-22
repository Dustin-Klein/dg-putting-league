'use client';

import { useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Status } from 'brackets-model';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { PlayerPicker, type PickedPlayer } from '@/components/player-picker';
import { ZoneBadge, formatDistanceFt } from '@/components/zone-badge';
import { cn } from '@/lib/utils/utils';
import { sortBySlot } from '@/lib/utils/team-utils';
import type { EventWithDetails } from '@/lib/types/event';
import type { PaymentType } from '@/lib/types/player';
import type { Team } from '@/lib/types/team';
import { useEventBracket } from './event-bracket-context';

const REASONS = [
  { value: 'missed_registration', label: 'Missed at registration' },
  { value: 'left_early', label: 'Left early' },
  { value: 'injury', label: 'Injury' },
  { value: 'wrong_player', label: 'Wrong player entered' },
] as const;
type Reason = (typeof REASONS)[number]['value'];

export interface ZonePreview {
  zone: number | null;
  putt_distance_ft: number;
}

export async function fetchZonePreview(eventId: string, playerIds: string[]): Promise<Map<string, ZonePreview>> {
  const params = new URLSearchParams(playerIds.map((id) => ['player_id', id]));
  const response = await fetch(`/api/event/${eventId}/zone-preview?${params}`);
  if (!response.ok) return new Map();
  const data: { players: Array<ZonePreview & { player_id: string }> } = await response.json();
  return new Map(data.players.map(({ player_id, ...zone }) => [player_id, zone]));
}

export function PaymentToggle({
  value,
  onChange,
  legend,
}: {
  value: PaymentType | null;
  onChange: (value: PaymentType | null) => void;
  legend: string;
}) {
  const options: Array<{ value: PaymentType | null; label: string }> = [
    { value: 'cash', label: 'Cash' },
    { value: 'electronic', label: 'Electronic' },
    { value: 'waived', label: 'Waived' },
    { value: null, label: 'Not yet' },
  ];
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1.5 text-[13px] font-semibold">{legend}</legend>
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        {options.map((option) => (
          <Button
            key={option.label}
            type="button"
            variant={value === option.value ? 'default' : 'outline'}
            aria-pressed={value === option.value}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </Button>
        ))}
      </div>
    </fieldset>
  );
}

function firstName(name: string) {
  return name.split(' ')[0] ?? name;
}

/** Which match the team plays next, and whether it is being played now, from the live bracket. */
function useNextMatch(team: Team | null) {
  const bracket = useEventBracket()?.bracketData;
  return useMemo(() => {
    if (!bracket || !team) return null;
    const participant = Object.entries(bracket.participantTeamMap).find(([, t]) => t.id === team.id)?.[0];
    if (!participant) return null;
    const pid = Number(participant);
    const mine = bracket.bracket.matches.filter((m) => {
      const o1 = m.opponent1 as { id?: number | null } | null;
      const o2 = m.opponent2 as { id?: number | null } | null;
      return o1?.id === pid || o2?.id === pid;
    });
    const played = mine.some((m) => m.status >= Status.Completed && m.opponent1 && m.opponent2);
    const next = mine.filter((m) => m.status < Status.Completed && m.opponent1 && m.opponent2).sort((a, b) => Number(a.id) - Number(b.id))[0];
    return { running: next?.status === Status.Running, played, hasNext: Boolean(next) };
  }, [bracket, team]);
}

/**
 * Swap a player onto a team during bracket play (mockup 2D). The incoming player putts
 * from their own zone; the outgoing player's frames stay theirs.
 */
export function SubstituteDialog({
  event,
  team,
  teams,
  open,
  onOpenChange,
  onDone,
}: {
  event: EventWithDetails;
  /** Preselected team; when null the dialog asks which team. */
  team: Team | null;
  teams: Team[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [teamId, setTeamId] = useState<string | null>(team?.id ?? null);
  const [outId, setOutId] = useState<string | null>(null);
  const [incoming, setIncoming] = useState<PickedPlayer | null>(null);
  const [incomingZone, setIncomingZone] = useState<ZonePreview | null>(null);
  const [reason, setReason] = useState<Reason>('missed_registration');
  const [payment, setPayment] = useState<PaymentType | null>('cash');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTeamId(team?.id ?? null);
    setOutId(null);
    setIncoming(null);
    setIncomingZone(null);
    setReason('missed_registration');
    setPayment('cash');
  }, [open, team]);

  useEffect(() => {
    if (!incoming) {
      setIncomingZone(null);
      return;
    }
    let cancelled = false;
    void fetchZonePreview(event.id, [incoming.id]).then((zones) => {
      if (!cancelled) setIncomingZone(zones.get(incoming.id) ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [event.id, incoming]);

  const selectedTeam = teams.find((t) => t.id === teamId) ?? null;
  const members = selectedTeam ? sortBySlot(selectedTeam.team_members) : [];
  const outgoing = members.find((m) => m.event_player_id === outId) ?? null;
  const next = useNextMatch(selectedTeam);
  const outName = outgoing?.event_player.player.full_name ?? '';
  const inName = incoming?.full_name ?? '';
  const zoneDiffers =
    event.handicap_enabled &&
    outgoing &&
    incomingZone &&
    (incomingZone.zone !== outgoing.event_player.zone ||
      incomingZone.putt_distance_ft !== outgoing.event_player.putt_distance_ft);
  const teamLine = members
    .map((m) => (m.event_player_id === outId && incoming ? `${m.event_player.player.full_name} → ${inName}` : m.event_player.player.full_name))
    .join(', ');
  const entries = event.players.length;

  const submit = async () => {
    if (!selectedTeam || !outgoing || !incoming) return;
    try {
      setSaving(true);
      const response = await fetch(`/api/event/${event.id}/teams/${selectedTeam.id}/substitute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          out_event_player_id: outgoing.event_player_id,
          player_id: incoming.id,
          payment_type: payment,
          reason,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Substitution failed');
      toast({
        title: `${inName} is on seed ${selectedTeam.seed}`,
        description: data.outEntryRemoved
          ? `${outName} hadn't putted, so their entry was removed.`
          : `${outName}'s frames stay on their record.`,
      });
      onOpenChange(false);
      onDone();
    } catch (error) {
      toast({
        title: 'Could not substitute',
        description: error instanceof Error ? error.message : 'Substitution failed',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex flex-col gap-0 overflow-hidden p-0 sm:max-w-[560px]">
        <DialogHeader className="gap-1 px-5 pt-[22px] pb-3 pr-14 text-left sm:px-6">
          <DialogTitle className="text-[22px] font-bold">
            Substitute a player{selectedTeam ? ` · Seed ${selectedTeam.seed}` : ''}
          </DialogTitle>
          <DialogDescription>
            {!selectedTeam
              ? 'Pick the team, who comes out and who goes in.'
              : next?.running
                ? <span className="font-semibold text-warning">This team is playing now. Substitute after the match.</span>
                : next?.hasNext
                  ? <>Next match <span className="font-semibold text-success">not started</span></>
                  : 'This team has no match waiting.'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto px-5 pb-4 sm:px-6">
          {!team && (
            <div className="flex flex-col gap-1.5">
              <label className="text-[13px] font-semibold" htmlFor="sub-team">Team</label>
              <Select value={teamId ?? undefined} onValueChange={(value) => { setTeamId(value); setOutId(null); }}>
                <SelectTrigger id="sub-team"><SelectValue placeholder="Choose a team" /></SelectTrigger>
                <SelectContent>
                  {teams.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      Seed {t.seed} · {sortBySlot(t.team_members).map((m) => m.event_player.player.full_name).join(', ')}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {selectedTeam && (
            <fieldset className="flex flex-col gap-1.5">
              <legend className="mb-1.5 text-[13px] font-semibold">Who comes out</legend>
              {members.map((member) => (
                <label
                  key={member.event_player_id}
                  className={cn(
                    'flex cursor-pointer items-center gap-3 rounded-[10px] border px-3 py-2.5',
                    outId === member.event_player_id && 'border-primary bg-muted/50'
                  )}
                >
                  <input
                    type="radio"
                    name="sub-out"
                    className="size-4 accent-primary"
                    checked={outId === member.event_player_id}
                    onChange={() => setOutId(member.event_player_id)}
                  />
                  <span className="flex flex-1 items-center justify-between gap-2">
                    <span className="text-[15px] font-semibold">{member.event_player.player.full_name}</span>
                    <ZoneBadge zone={member.event_player.zone} distanceFt={member.event_player.putt_distance_ft} size="sm" />
                  </span>
                </label>
              ))}
            </fieldset>
          )}

          <PlayerPicker eventId={event.id} id="sub-in" label="Who goes in" value={incoming} onChange={setIncoming} />
          {incoming && incomingZone?.zone != null && (
            <div className="-mt-2 flex justify-end">
              <ZoneBadge zone={incomingZone.zone} distanceFt={incomingZone.putt_distance_ft} />
            </div>
          )}

          {zoneDiffers && (
            <div className="flex flex-col gap-0.5 rounded-[10px] border border-warning/40 bg-warning/10 px-3 py-2.5">
              <span className="text-sm font-bold">
                {firstName(inName)} putts from {formatDistanceFt(incomingZone!.putt_distance_ft)} ft, not {firstName(outName)}&apos;s{' '}
                {formatDistanceFt(outgoing!.event_player.putt_distance_ft ?? event.putt_distance_ft)} ft
              </span>
              <span className="text-[13px] text-muted-foreground">
                The scorecard shows {firstName(inName)}&apos;s own zone from the next match on.
              </span>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label className="text-[13px] font-semibold" htmlFor="sub-reason">Reason</label>
              <Select value={reason} onValueChange={(value) => setReason(value as Reason)}>
                <SelectTrigger id="sub-reason"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {REASONS.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <PaymentToggle value={payment} onChange={setPayment} legend={incoming ? `${firstName(inName)} paid` : 'Paid'} />
          </div>

          {outgoing && incoming && (
            <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-[13px] leading-[1.45] text-muted-foreground">
              {next?.played || event.qualification_round_enabled ? (
                <>
                  <li>{firstName(outName)}&apos;s frames already recorded stay on {firstName(outName)}&apos;s record and still count for the team&apos;s results.</li>
                  <li>If {firstName(outName)} putted, their entry stays: {entries + 1} entries count toward the payout. Otherwise it is removed.</li>
                </>
              ) : (
                <li>{firstName(outName)} hasn&apos;t putted, so their entry is removed: still {entries} entries toward the payout.</li>
              )}
              <li>Teams show &ldquo;{teamLine}&rdquo;.</li>
            </ul>
          )}
        </div>

        <DialogFooter className="gap-2.5 border-t px-5 py-4 sm:px-6">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={submit} disabled={saving || !outgoing || !incoming || next?.running === true}>
            {saving && <Loader2 className="mr-2 size-4 animate-spin" />}
            {outgoing && incoming ? `Substitute ${firstName(inName)} for ${firstName(outName)}` : 'Substitute'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
