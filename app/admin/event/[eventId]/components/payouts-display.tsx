'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { DollarSign, RotateCcw, Plus, Trash2 } from 'lucide-react';
import type { EventPayoutInfo } from '@/lib/services/event/event-service';
import type { EventStatus } from '@/lib/types/event';

interface PayoutsDisplayProps {
  eventId: string;
  eventStatus: EventStatus;
  isAdmin: boolean;
}

export function PayoutsDisplay({ eventId, eventStatus, isAdmin }: PayoutsDisplayProps) {
  const [payoutInfo, setPayoutInfo] = useState<EventPayoutInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editStructure, setEditStructure] = useState<{ place: number; percentage: number }[]>([]);
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

  const startEditing = () => {
    if (!payoutInfo) return;
    setEditStructure(payoutInfo.structure.map((s) => ({ ...s })));
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
        body: JSON.stringify({ payout_structure: editStructure }),
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
        body: JSON.stringify({ payout_structure: null }),
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
      <div className="animate-pulse space-y-4">
        <div className="h-8 bg-muted rounded w-48"></div>
        <div className="h-48 bg-muted rounded"></div>
      </div>
    );
  }

  if (error || !payoutInfo) {
    return (
      <div className="text-center py-8">
        <p className="text-muted-foreground">{error || 'No payout information available'}</p>
      </div>
    );
  }

  const canEdit = isAdmin && eventStatus === 'bracket';

  const formatCurrency = (amount: number) =>
    `$${amount.toFixed(2)}`;

  const getPlaceLabel = (place: number) => {
    if (place === 1) return '1st';
    if (place === 2) return '2nd';
    if (place === 3) return '3rd';
    return `${place}th`;
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <DollarSign className="h-5 w-5" />
            <CardTitle>Payouts</CardTitle>
          </div>
          {canEdit && !editing && (
            <Button variant="outline" size="sm" onClick={startEditing}>
              Edit
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-3 gap-4 text-center">
          <div>
            <p className="text-sm text-muted-foreground">Entry Fee</p>
            <p className="text-lg font-semibold">{formatCurrency(payoutInfo.entry_fee_per_player)}</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Players</p>
            <p className="text-lg font-semibold">{payoutInfo.player_count}</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Total Pot</p>
            <p className="text-lg font-semibold">{formatCurrency(payoutInfo.total_pot)}</p>
          </div>
        </div>

        {payoutInfo.admin_fees > 0 && (
          <div className="grid grid-cols-2 gap-4 text-center border-t pt-4">
            <div>
              <p className="text-sm text-muted-foreground">Admin Fees</p>
              <p className="text-lg font-semibold text-destructive">-{formatCurrency(payoutInfo.admin_fees)}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Payout Pool</p>
              <p className="text-lg font-semibold">{formatCurrency(payoutInfo.total_pot - payoutInfo.admin_fees)}</p>
            </div>
          </div>
        )}

        {editing ? (
          <div className="space-y-3">
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-20">Place</TableHead>
                    <TableHead>Percentage</TableHead>
                    <TableHead className="w-16"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {editStructure.map((entry, index) => (
                    <TableRow key={entry.place}>
                      <TableCell>{getPlaceLabel(entry.place)}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Input
                            type="number"
                            min="0"
                            max="100"
                            step="1"
                            value={entry.percentage}
                            onChange={(e) => handlePercentageChange(index, e.target.value)}
                            className="w-20"
                          />
                          <span className="text-muted-foreground">%</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        {editStructure.length > 1 && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => removePlace(index)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="flex items-center justify-between">
              <Button variant="outline" size="sm" onClick={addPlace}>
                <Plus className="h-4 w-4 mr-1" />
                Add Place
              </Button>
              <p className={`text-sm ${Math.abs(percentageSum - 100) > 0.01 ? 'text-destructive' : 'text-muted-foreground'}`}>
                Total: {percentageSum}%
              </p>
            </div>

            {saveError && (
              <p className="text-sm text-destructive">{saveError}</p>
            )}

            <div className="flex gap-2 justify-end">
              <Button variant="outline" size="sm" onClick={handleReset} disabled={saving}>
                <RotateCcw className="h-4 w-4 mr-1" />
                Reset to Default
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
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-20">Place</TableHead>
                  <TableHead>Percentage</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payoutInfo.payouts.map((payout) => (
                  <TableRow key={payout.place}>
                    <TableCell className="font-medium">{getPlaceLabel(payout.place)}</TableCell>
                    <TableCell>{payout.percentage}%</TableCell>
                    <TableCell className="text-right font-semibold">
                      {formatCurrency(payout.amount)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {payoutInfo.is_custom && !editing && (
          <p className="text-xs text-muted-foreground text-center">Custom payout structure</p>
        )}
      </CardContent>
    </Card>
  );
}
