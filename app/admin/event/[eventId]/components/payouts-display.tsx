'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { StatusBadge } from '@/components/status-badge';
import { RotateCcw, Plus, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils/utils';
import { formatPlacement } from '@/lib/utils/format-utils';
import type { EventPayoutInfo } from '@/lib/services/event/event-service';
import type { EventStatus } from '@/lib/types/event';

interface PayoutsDisplayProps {
  eventId: string;
  eventStatus: EventStatus;
  isAdmin: boolean;
  /** Off inside a dialog that already titles it "Payouts". */
  showHeading?: boolean;
}

export function PayoutsDisplay({ eventId, eventStatus, isAdmin, showHeading = true }: PayoutsDisplayProps) {
  const [payoutInfo, setPayoutInfo] = useState<EventPayoutInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editStructure, setEditStructure] = useState<{ place: number; percentage: number }[]>([]);
  const [editPoolOverride, setEditPoolOverride] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const fetchPayouts = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/event/${eventId}/payouts`);
      if (response.status === 404) {
        setPayoutInfo(null);
        return;
      }
      if (!response.ok) {
        throw new Error('Failed to load payouts');
      }
      const data = await response.json();
      setPayoutInfo(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load payouts');
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    fetchPayouts();
  }, [fetchPayouts]);

  const calculatedPool = payoutInfo
    ? Math.max(0, payoutInfo.total_pot - payoutInfo.admin_fees - (payoutInfo.admin_fee_per_player * payoutInfo.player_count))
    : 0;

  const startEditing = () => {
    if (!payoutInfo) return;
    setEditStructure(payoutInfo.structure.map((s) => ({ ...s })));
    setEditPoolOverride(payoutInfo.payout_pool_override);
    setEditing(true);
    setSaveError(null);
  };

  const handlePercentageChange = (index: number, value: string) => {
    const updated = [...editStructure];
    const numericValue = Number(value);
    const clampedValue = isNaN(numericValue) ? 0 : Math.max(0, Math.min(100, numericValue));
    updated[index] = { ...updated[index], percentage: clampedValue };
    setEditStructure(updated);
  };

  const addPlace = () => {
    const nextPlace = editStructure.length + 1;
    setEditStructure([...editStructure, { place: nextPlace, percentage: 0 }]);
  };

  const removePlace = (index: number) => {
    if (editStructure.length <= 1) return;
    const updated = editStructure.filter((_, i) => i !== index);
    // Re-number places
    const renumbered = updated.map((s, i) => ({ ...s, place: i + 1 }));
    setEditStructure(renumbered);
  };

  const percentageSum = editStructure.reduce((sum, s) => sum + s.percentage, 0);

  const handleSave = async () => {
    if (Math.abs(percentageSum - 100) > 0.01) {
      setSaveError('Percentages must sum to 100');
      return;
    }

    setSaving(true);
    setSaveError(null);
    try {
      const response = await fetch(`/api/event/${eventId}/payouts`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payout_structure: editStructure, payout_pool_override: editPoolOverride }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data?.error || 'Failed to save payouts');
      }

      const data = await response.json();
      setPayoutInfo(data);
      setEditing(false);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const response = await fetch(`/api/event/${eventId}/payouts`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payout_structure: null, payout_pool_override: null }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data?.error || 'Failed to reset payouts');
      }

      const data = await response.json();
      setPayoutInfo(data);
      setEditing(false);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to reset');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="animate-pulse space-y-4 rounded-2xl border bg-card p-5">
        <div className="h-6 bg-muted rounded w-32"></div>
        <div className="h-40 bg-muted rounded"></div>
      </div>
    );
  }

  if (error || !payoutInfo) {
    return (
      <div className="rounded-2xl border bg-card p-5 text-center">
        <p className="text-sm text-muted-foreground">{error || 'No payout information available'}</p>
      </div>
    );
  }

  const canEdit = isAdmin && eventStatus === 'bracket';
  const perPlayerFees = payoutInfo.admin_fee_per_player * payoutInfo.player_count;
  const pool = payoutInfo.payout_pool_override != null ? payoutInfo.payout_pool_override : calculatedPool;

  const formatCurrency = (amount: number) =>
    `$${amount.toFixed(2)}`;

  return (
    <section aria-labelledby={showHeading ? 'payouts-heading' : undefined} className={cn('flex flex-col gap-2', showHeading && 'rounded-2xl border bg-card p-5')}>
      {(showHeading || (canEdit && !editing)) && (
        <div className="mb-1 flex items-center justify-between gap-2">
          {showHeading && <h2 id="payouts-heading" className="text-lg font-bold">Payouts</h2>}
          {canEdit && !editing && (
            <Button variant="outline" size="sm" onClick={startEditing} className="ml-auto">
              Edit
            </Button>
          )}
        </div>
      )}

      <MoneyRow label={`${payoutInfo.player_count} ${payoutInfo.player_count === 1 ? 'player' : 'players'} × ${formatCurrency(payoutInfo.entry_fee_per_player)} entry`}>
        {formatCurrency(payoutInfo.total_pot)}
      </MoneyRow>
      {payoutInfo.admin_fees > 0 && (
        <MoneyRow label="Flat admin fees">−{formatCurrency(payoutInfo.admin_fees)}</MoneyRow>
      )}
      {payoutInfo.admin_fee_per_player > 0 && (
        <MoneyRow label={`Admin fees (${formatCurrency(payoutInfo.admin_fee_per_player)} per player)`}>
          −{formatCurrency(perPlayerFees)}
        </MoneyRow>
      )}
      <MoneyRow
        label={payoutInfo.payout_pool_override != null ? 'Payout pool (adjusted)' : 'Payout pool'}
        className="text-2xl"
      >
        {formatCurrency(pool)}
      </MoneyRow>

      {editing ? (
        <div className="flex flex-col gap-3 border-t border-muted pt-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="payout-pool-override" className="text-[13px] font-semibold">Payout pool override</label>
            <div className="flex items-center gap-2">
              <div className="relative">
                <span className="absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted-foreground">$</span>
                <Input
                  id="payout-pool-override"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder={calculatedPool.toFixed(2)}
                  value={editPoolOverride ?? ''}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === '') {
                      setEditPoolOverride(null);
                    } else {
                      const num = Number(val);
                      if (Number.isFinite(num) && num >= 0) {
                        setEditPoolOverride(num);
                      }
                    }
                  }}
                  className="h-10 w-32 pl-7"
                />
              </div>
              {editPoolOverride != null && (
                <Button variant="ghost" size="sm" onClick={() => setEditPoolOverride(null)}>
                  Clear
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Leave empty to use calculated pool ({formatCurrency(calculatedPool)})
            </p>
          </div>

          <div className="flex flex-col">
            {editStructure.map((entry, index) => (
              <div key={entry.place} className="flex items-center gap-2 border-t border-muted py-2">
                <span className="w-12 font-score text-xl leading-none font-bold">{formatPlacement(entry.place)}</span>
                <div className="relative">
                  <Input
                    type="number"
                    min="0"
                    max="100"
                    step="1"
                    aria-label={`${formatPlacement(entry.place)} place percentage`}
                    value={entry.percentage}
                    onChange={(e) => handlePercentageChange(index, e.target.value)}
                    className="h-10 w-24 pr-7"
                  />
                  <span className="absolute top-1/2 right-3 -translate-y-1/2 text-sm text-muted-foreground">%</span>
                </div>
                {editStructure.length > 1 && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="ml-auto text-destructive hover:bg-destructive/10"
                    onClick={() => removePlace(index)}
                  >
                    <Trash2 className="h-4 w-4" />
                    <span className="sr-only">Remove {formatPlacement(entry.place)} place</span>
                  </Button>
                )}
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between">
            <Button variant="outline" size="sm" onClick={addPlace}>
              <Plus className="h-4 w-4 mr-1" />
              Add place
            </Button>
            <p className={cn('text-sm tabular-nums', Math.abs(percentageSum - 100) > 0.01 ? 'text-destructive' : 'text-muted-foreground')}>
              Total: {percentageSum}%
            </p>
          </div>

          {saveError && (
            <p className="text-sm text-destructive">{saveError}</p>
          )}

          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" size="sm" onClick={handleReset} disabled={saving}>
              <RotateCcw className="h-4 w-4 mr-1" />
              Reset to default
            </Button>
            <Button variant="outline" size="sm" onClick={() => setEditing(false)} disabled={saving}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleSave} disabled={saving || Math.abs(percentageSum - 100) > 0.01}>
              {saving ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </div>
      ) : (
        <>
          {payoutInfo.payouts.map((payout) => (
            <MoneyRow key={payout.place} label={`${formatPlacement(payout.place)} · ${payout.percentage}%`} strong>
              {formatCurrency(payout.amount)}
            </MoneyRow>
          ))}
          <div className="flex items-center justify-between gap-3 border-t border-muted pt-3 text-sm">
            <span className="font-semibold">Payout structure</span>
            <StatusBadge tone={payoutInfo.is_custom ? 'warning' : 'outline'}>
              {payoutInfo.is_custom ? 'Custom' : 'Default'}
            </StatusBadge>
          </div>
        </>
      )}
    </section>
  );
}

function MoneyRow({
  label,
  strong = false,
  className,
  children,
}: {
  label: string;
  strong?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-t border-muted py-2 text-sm">
      <span className={strong ? 'text-foreground' : 'text-muted-foreground'}>{label}</span>
      <span className={cn('font-score text-xl leading-none font-bold tabular-nums', className)}>{children}</span>
    </div>
  );
}
