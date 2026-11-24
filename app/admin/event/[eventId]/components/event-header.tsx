'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { QRCodeSVG } from 'qrcode.react';
import { Check, Copy, Lock, Pencil, QrCode } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useToast } from '@/components/ui/use-toast';
import { useCoalescedRefresh } from '@/lib/hooks/use-coalesced-refresh';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils/utils';
import { NextStatusButton } from '@/components/next-status-button';
import { StatusTrack } from '@/components/event-status-track';
import { zoneColorClass } from '@/components/zone-badge';
import { formatDisplayDate } from '@/lib/utils/date-utils';
import { eventFormatParts, formatMoney } from '@/lib/utils/event-setup';
import { bracketProgress, headerStats, laneChips, type BracketProgress, type HeaderStat, type LaneChips } from '@/lib/utils/event-progress';
import type { Lane } from '@/lib/types/bracket';
import type { EventWithDetails } from '@/lib/types/event';
import { ZoneDistancesPopover, useEventHandicap } from './event-handicap';
import { useEventBracket } from './event-bracket-context';

interface QualificationProgress {
  done: number;
  total: number;
}

/**
 * Players who finished their qualification frames; admins only, before the bracket.
 * Refreshes on the same qualification_frames changes the roster listens to.
 */
function useQualificationProgress(event: EventWithDetails): QualificationProgress | null {
  const [progress, setProgress] = useState<QualificationProgress | null>(null);
  const active = event.viewer_is_admin === true && event.status === 'pre-bracket' && event.qualification_round_enabled;
  const playerCount = event.players.length;

  const load = useCallback(async (signal: AbortSignal) => {
    try {
      const response = await fetch(`/api/event/${event.id}/qualification`, { signal });
      if (!response.ok || signal.aborted) return;
      const data: { players?: Array<{ is_complete: boolean }> } = await response.json();
      if (signal.aborted || !data.players) return;
      setProgress({ done: data.players.filter((player) => player.is_complete).length, total: data.players.length });
    } catch {
      // Progress is a hint; the roster below shows the authoritative status.
    }
  }, [event.id]);
  const refresh = useCoalescedRefresh(load, event.id);

  useEffect(() => {
    if (active) refresh.refresh();
  }, [active, refresh, playerCount]);

  useEffect(() => {
    if (!active) return;
    const channel = createClient()
      .channel(`header-qualification-${event.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'putting_league', table: 'qualification_frames', filter: `event_id=eq.${event.id}` },
        () => refresh.request()
      )
      .subscribe();
    return () => {
      channel.unsubscribe();
    };
  }, [active, event.id, refresh]);

  return active ? progress : null;
}

function ScoringCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast({ title: 'Could not copy', description: 'Select the code and copy it instead.' });
    }
  };
  const iconButton =
    'flex h-[27px] w-11 items-center justify-center rounded-md border text-muted-foreground hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-hidden';
  return (
    <div className="flex flex-col items-start gap-2.5 sm:items-end">
      <span className="text-xs font-bold tracking-[0.08em] text-muted-foreground uppercase">Scoring code · /score</span>
      <div className="flex items-center gap-2.5">
        {code.length <= 8 ? (
          <span aria-label={code} className="flex gap-1.5">
            {code.split('').map((char, index) => (
              <span
                key={index}
                aria-hidden="true"
                className="flex h-[52px] w-[38px] items-center justify-center rounded-lg border bg-card font-score text-[34px] font-bold text-gold uppercase sm:h-[60px] sm:w-[46px] sm:text-[40px]"
              >
                {char}
              </span>
            ))}
          </span>
        ) : (
          <code className="rounded-lg border bg-card px-3 py-2 font-score text-[34px] leading-none font-bold tracking-[0.08em] break-all text-gold uppercase sm:text-[40px]">
            {code}
          </code>
        )}
        <span className="flex flex-col gap-1.5">
          <button type="button" aria-label={copied ? 'Copied' : 'Copy scoring code'} onClick={copy} className={iconButton}>
            {copied ? <Check className="size-[15px] text-success" aria-hidden="true" /> : <Copy className="size-[15px]" aria-hidden="true" />}
          </button>
          <Popover>
            <PopoverTrigger asChild>
              <button type="button" aria-label="Show scoring QR code" className={iconButton}>
                <QrCode className="size-[15px]" aria-hidden="true" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-auto rounded-[14px] p-3">
              <div className="rounded-lg bg-white p-2">
                <QRCodeSVG
                  value={`${window.location.origin}/score?code=${encodeURIComponent(code)}`}
                  size={176}
                  marginSize={1}
                  role="img"
                  aria-label="Scan to keep score"
                />
              </div>
            </PopoverContent>
          </Popover>
        </span>
      </div>
    </div>
  );
}

function Stat({ label, children, first }: { label: React.ReactNode; children: React.ReactNode; first?: boolean }) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1 py-1', !first && 'sm:border-l sm:pl-5', 'sm:pr-5')}>
      <dt className="flex items-center gap-1.5 text-[13px] font-semibold text-muted-foreground">{label}</dt>
      <dd className="m-0 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">{children}</dd>
    </div>
  );
}

const big = 'font-score text-[34px] leading-none font-bold tabular-nums';

const LANE_STATE_LABEL = { in_play: 'in play', open: 'open', maintenance: 'in maintenance', lent: 'lent to the second chance' } as const;

function LaneChipRow({ chips }: { chips: LaneChips }) {
  return (
    <>
      <span className="flex flex-wrap gap-1.5">
        {chips.lanes.map((lane) => (
          <span
            key={lane.id}
            title={`${lane.label}: ${LANE_STATE_LABEL[lane.state]}`}
            className={cn(
              'flex h-[30px] min-w-[26px] items-center justify-center rounded-md px-1 font-score text-lg font-bold',
              lane.state === 'in_play' && 'bg-success text-background',
              lane.state === 'open' && 'border-[1.5px] border-dashed border-muted-foreground/60 text-muted-foreground',
              lane.state === 'maintenance' && 'bg-warning/20 text-warning line-through',
              lane.state === 'lent' && 'bg-info/15 text-info'
            )}
          >
            {lane.label.replace(/^Lane\s*/i, '')}
            <span className="sr-only">: {LANE_STATE_LABEL[lane.state]}</span>
          </span>
        ))}
      </span>
      <span className="text-[13px] text-muted-foreground">
        {chips.lanesInPlay} in play
        {chips.lanesInMaintenance > 0 && ` · ${chips.lanesInMaintenance} in maintenance`}
        {chips.lanesLent > 0 && <span className="text-info"> · {chips.lanesLent} at second chance</span>}
      </span>
    </>
  );
}

/** A second chance's borrowed lanes, before its bracket data has any. */
function useBorrowedLanes(event: EventWithDetails, skip: boolean): LaneChips | null {
  const [chips, setChips] = useState<LaneChips | null>(null);
  const enabled = event.link_type === 'second_chance' && !skip;
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const load = () => fetch(`/api/event/${event.id}/lanes`)
      .then((response) => (response.ok ? response.json() : []))
      .then((lanes: Lane[]) => { if (!cancelled) setChips(laneChips(lanes)); })
      .catch(() => {});
    load();
    // Lending happens on the main event, which this page doesn't subscribe to.
    const timer = setInterval(load, 20000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [enabled, event.id, event.status]);
  return enabled ? chips : null;
}

function DistanceStat({ event, first }: { event: EventWithDetails; first: boolean }) {
  const handicap = useEventHandicap();
  const view = handicap?.view;
  if (!event.handicap_enabled) {
    return <Stat label="Distance" first={first}><span className={big}>{event.putt_distance_ft} ft</span></Stat>;
  }
  if (!view || view.zones.length === 0) {
    return <Stat label="Distance" first={first}><span className={big}>By zone</span></Stat>;
  }
  const ladder = (
    <span className="flex items-center gap-2">
      {view.zones.map((zone) => (
        <span key={zone.zone} className="inline-flex items-center gap-1.5">
          <span className={cn('size-2.5 rounded-full', zoneColorClass(zone.zone))} aria-hidden="true" />
          <span className="font-score text-[28px] leading-none font-bold tabular-nums">{zone.distance_ft}</span>
        </span>
      ))}
      <span className="text-[13px] text-muted-foreground">ft</span>
    </span>
  );
  const ladderText = view.zones.map((zone) => `Zone ${zone.zone} ${zone.distance_ft} feet`).join(', ');
  return (
    <Stat
      first={first}
      label={
        <>
          {event.status === 'created' || event.status === 'pre-bracket' ? 'Distances tonight' : 'Distances'}
          {view.editable
            ? <Pencil className="size-3.5" aria-hidden="true" />
            : <Lock className="size-3.5" aria-label="Locked" role="img" />}
        </>
      }
    >
      <ZoneDistancesPopover>
        <button
          type="button"
          aria-label={`${ladderText}. ${view.editable ? 'Edit' : 'View'} tonight's zone distances`}
          className="-mx-1.5 rounded-md px-1.5 py-0.5 hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-hidden"
        >
          {ladder}
        </button>
      </ZoneDistancesPopover>
    </Stat>
  );
}

/** A second chance's lanes, borrowed from its main event. */
function SecondChanceLanes({ chips }: { chips: LaneChips | null }) {
  if (!chips) return <span className={big}>–</span>;
  if (chips.lanes.length === 0) return <span className="text-[15px] font-semibold text-muted-foreground">None lent yet</span>;
  return <LaneChipRow chips={chips} />;
}

function StatCell({
  stat,
  event,
  bracket,
  borrowed,
  first,
}: {
  stat: HeaderStat;
  event: EventWithDetails;
  bracket: BracketProgress | null;
  borrowed: LaneChips | null;
  first: boolean;
}) {
  const players = event.players;
  const isAdmin = event.viewer_is_admin === true;
  switch (stat) {
    case 'players': {
      const unpaid = players.filter((player) => player.payment_type === null).length;
      return (
        <Stat label="Players" first={first}>
          <span className={big}>{players.length}</span>
          {isAdmin && players.length > 0 && (
            unpaid > 0
              ? <span className="text-[13px] font-semibold text-warning">{unpaid} unpaid</span>
              : <span className="text-[13px] text-muted-foreground">all paid</span>
          )}
        </Stat>
      );
    }
    case 'pot': {
      const fee = Number(event.entry_fee_per_player ?? 0);
      const cash = players.filter((player) => player.payment_type === 'cash').length * fee;
      const electronic = players.filter((player) => player.payment_type === 'electronic').length * fee;
      const waived = players.filter((player) => player.payment_type === 'waived').length * fee;
      return (
        <Stat label={`Pot · ${formatMoney(fee)} entry`} first={first}>
          <span className={big}>{formatMoney(cash + electronic + waived)}</span>
          <span className="text-[13px] text-muted-foreground">
            <span className="whitespace-nowrap">{formatMoney(cash)} cash</span> · <span className="whitespace-nowrap">{formatMoney(electronic)} electronic</span>
            {waived > 0 && <> · <span className="whitespace-nowrap">{formatMoney(waived)} waived</span></>}
          </span>
        </Stat>
      );
    }
    case 'lanes':
      return (
        <Stat label="Lanes" first={first}>
          {event.link_type === 'second_chance'
            ? <SecondChanceLanes chips={borrowed} />
            : <span className={big}>{event.lane_count}</span>}
        </Stat>
      );
    case 'matches':
      return (
        <Stat label="Matches played" first={first}>
          <span className={big}>
            {bracket ? bracket.played : '–'}
            <span className="text-muted-foreground">/{bracket ? bracket.total : '–'}</span>
          </span>
        </Stat>
      );
    case 'lanes_live':
      return (
        <Stat label="Lanes" first={first}>
          {bracket && bracket.lanes.length > 0 ? (
            <LaneChipRow chips={bracket} />
          ) : event.link_type === 'second_chance' ? (
            <SecondChanceLanes chips={borrowed} />
          ) : (
            <span className={big}>{event.lane_count}</span>
          )}
        </Stat>
      );
    case 'teams':
      return (
        <Stat label="Teams" first={first}>
          <span className={big}>{bracket?.teams ?? event.teams?.length ?? 0}</span>
        </Stat>
      );
    case 'distance':
      return <DistanceStat event={event} first={first} />;
  }
}

export function EventHeader({ event, onStatusUpdate }: { event: EventWithDetails; onStatusUpdate?: () => void }) {
  const isAdmin = event.viewer_is_admin === true;
  const bracketContext = useEventBracket();
  const bracket = event.status === 'bracket' && bracketContext?.bracketData ? bracketProgress(bracketContext.bracketData) : null;
  const borrowed = useBorrowedLanes(event, (bracket?.lanes.length ?? 0) > 0);
  const qualification = useQualificationProgress(event);
  const trackProgress = event.status === 'bracket'
    ? (bracket ? { done: bracket.played, total: bracket.total } : null)
    : qualification;
  const live = event.status === 'bracket';
  const showPublicLink = event.status === 'bracket' || event.status === 'completed';
  const stats = headerStats(event, isAdmin);

  return (
    <div className="flex flex-col gap-[18px]">
      <section
        aria-label="Event"
        className="dark flex flex-col justify-between gap-6 rounded-[18px] border bg-board px-5 py-6 text-foreground sm:flex-row sm:items-center sm:px-[30px] sm:py-[26px]"
      >
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-3.5">
            <h1 className="font-score text-5xl leading-[0.95] font-bold sm:text-[64px]">{formatDisplayDate(event.event_date)}</h1>
            {live && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-success/15 px-2.5 py-1 text-[13px] font-bold text-success">
                <span className="size-2 rounded-full bg-success" aria-hidden="true" />
                Live
              </span>
            )}
          </div>
          <p className="text-base text-foreground/80">
            {event.location || 'No location set'}
            {showPublicLink && (
              <>
                {' · '}
                <Link href={`/event/${event.id}/bracket`} className="text-info hover:underline">Public bracket</Link>
                {' · '}
                <Link href={`/event/${event.id}/stats`} className="text-info hover:underline">Public stats</Link>
              </>
            )}
          </p>
          <p className="text-sm text-balance text-muted-foreground">{eventFormatParts(event).join(' · ')}</p>
        </div>
        {event.access_code && <ScoringCode code={event.access_code} />}
      </section>

      <div className="flex flex-wrap items-center justify-between gap-4">
        <StatusTrack status={event.status} qualifying={event.qualification_round_enabled} progress={trackProgress} />
        <NextStatusButton event={event} onStatusUpdate={onStatusUpdate} />
      </div>

      <dl
        className="m-0 grid grid-cols-2 gap-x-4 gap-y-3 border-t pt-4 sm:grid-cols-[repeat(var(--stat-columns),minmax(0,1fr))] sm:gap-0"
        style={{ '--stat-columns': stats.length } as React.CSSProperties}
      >
        {stats.map((stat, index) => (
          <StatCell key={stat} stat={stat} event={event} bracket={bracket} borrowed={borrowed} first={index === 0} />
        ))}
      </dl>
    </div>
  );
}
