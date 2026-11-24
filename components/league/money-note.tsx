import { formatMoney } from '@/lib/utils/event-setup';

type MoneyEvent = { status: string; participant_count: number; paid_count: number; entry_fee_per_player: number | null };

/** Unpaid players until everyone has paid, then the pot once the night is over. */
export function MoneyNote({ event }: { event: MoneyEvent }) {
  if (event.participant_count === 0) return null;
  const unpaid = event.participant_count - event.paid_count;
  if (unpaid > 0) return <span className="text-[13px] font-semibold text-warning">{unpaid} unpaid</span>;
  if (event.status === 'completed' && event.entry_fee_per_player) {
    return <span className="text-[13px] text-muted-foreground">{formatMoney(event.paid_count * event.entry_fee_per_player)} pot</span>;
  }
  return <span className="text-[13px] text-muted-foreground">all paid</span>;
}
