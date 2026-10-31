'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { RefreshCw, Plus, Trash2, Wrench, Play, Unlock, Link } from 'lucide-react';
import { MatchStatus, type LaneWithMatch } from '@/lib/types/bracket';
import { cn } from '@/lib/utils/utils';

interface LaneManagementProps {
  eventId: string;
}

export function LaneManagement({ eventId }: LaneManagementProps) {
  const [lanes, setLanes] = useState<LaneWithMatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addCount, setAddCount] = useState(1);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [assignMatchIds, setAssignMatchIds] = useState<Record<string, string>>({});

  const fetchLanes = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/event/${eventId}/lanes`);
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to fetch lanes');
      }
      const data = await res.json();
      setLanes(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch lanes');
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    fetchLanes();
  }, [fetchLanes]);

  const handleAddLanes = async () => {
    try {
      setActionLoading('add');
      const res = await fetch(`/api/event/${eventId}/lanes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'add', count: addCount }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to add lanes');
      }
      await fetchLanes();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to add lanes');
    } finally {
      setActionLoading(null);
    }
  };

  const handleAutoAssign = async () => {
    try {
      setActionLoading('auto-assign');
      const res = await fetch(`/api/event/${eventId}/lanes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'auto-assign' }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to auto-assign');
      }
      await fetchLanes();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to auto-assign');
    } finally {
      setActionLoading(null);
    }
  };

  const handleDeleteLane = async (laneId: string) => {
    try {
      setActionLoading(laneId);
      const res = await fetch(`/api/event/${eventId}/lanes/${laneId}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to delete lane');
      }
      await fetchLanes();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete lane');
    } finally {
      setActionLoading(null);
    }
  };

  const handleSetMaintenance = async (
    laneId: string,
    mode: 'after_match' | 'now' = 'after_match'
  ) => {
    if (
      mode === 'now' &&
      !window.confirm('Stop scoring on this lane now? The running match will be left without a lane.')
    ) {
      return;
    }

    try {
      setActionLoading(laneId);
      const res = await fetch(`/api/event/${eventId}/lanes/${laneId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'maintenance', mode }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to set maintenance');
      }
      await fetchLanes();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to set maintenance');
    } finally {
      setActionLoading(null);
    }
  };

  const handleSetIdle = async (laneId: string) => {
    try {
      setActionLoading(laneId);
      const res = await fetch(`/api/event/${eventId}/lanes/${laneId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'idle' }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to activate lane');
      }
      await fetchLanes();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to activate lane');
    } finally {
      setActionLoading(null);
    }
  };

  const handleReleaseLane = async (laneId: string, matchId: number, force = false) => {
    try {
      setActionLoading(laneId);
      const res = await fetch(`/api/event/${eventId}/lanes/${laneId}/release`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ matchId, force }),
      });
      if (!res.ok) {
        const data = await res.json();
        if (res.status === 409 && !force && window.confirm(`${data.error}\n\nForce release?`)) {
          setActionLoading(null);
          await handleReleaseLane(laneId, matchId, true);
          return;
        }
        throw new Error(data.error || 'Failed to release lane');
      }
      await fetchLanes();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to release lane');
    } finally {
      setActionLoading(null);
    }
  };

  const handleAssignLane = async (laneId: string) => {
    const matchIdStr = assignMatchIds[laneId];
    const matchId = parseInt(matchIdStr, 10);
    if (!matchIdStr || isNaN(matchId)) {
      alert('Enter a valid match number');
      return;
    }
    try {
      setActionLoading(laneId);
      const res = await fetch(`/api/event/${eventId}/lanes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'assign', laneId, matchNumber: matchId }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to assign lane');
      }
      setAssignMatchIds((prev) => ({ ...prev, [laneId]: '' }));
      await fetchLanes();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to assign lane');
    } finally {
      setActionLoading(null);
    }
  };

  const idleCount = lanes.filter((l) => l.status === 'idle').length;
  const occupiedCount = lanes.filter((l) => l.status === 'occupied').length;
  const maintenanceCount = lanes.filter((l) => l.status === 'maintenance').length;

  const laneState = (lane: LaneWithMatch): { tile: string; tone: string; label: string } => {
    const match = lane.current_match_id ? `M${lane.current_match_number ?? lane.current_match_id}` : null;
    if (lane.status === 'occupied' && lane.current_match_status === MatchStatus.Running) {
      return { tile: 'bg-success/15 text-success', tone: 'text-success', label: `Occupied · ${match} in progress` };
    }
    if (lane.status === 'occupied') {
      return { tile: 'bg-warning/15 text-warning', tone: 'text-warning', label: `Occupied · ${match ?? 'match'} called, not started` };
    }
    if (lane.status === 'maintenance') {
      return { tile: 'bg-muted text-muted-foreground', tone: 'text-muted-foreground', label: 'Maintenance' };
    }
    if (lane.status === 'idle') {
      return { tile: 'border-[1.5px] border-dashed border-input text-foreground', tone: 'text-muted-foreground', label: 'Idle · no match' };
    }
    return { tile: 'bg-muted text-muted-foreground', tone: 'text-muted-foreground', label: lane.status };
  };

  if (loading && lanes.length === 0) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-8 bg-muted rounded w-48"></div>
        <div className="h-32 bg-muted rounded"></div>
      </div>
    );
  }

  if (error && lanes.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">{error}</p>
        <Button onClick={fetchLanes} className="mt-4">
          <RefreshCw className="mr-2 h-4 w-4" />
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Header bar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span>{lanes.length} total</span>
          <span aria-hidden="true">·</span>
          <span>{idleCount} idle</span>
          <span aria-hidden="true">·</span>
          <span className="text-success">{occupiedCount} occupied</span>
          {maintenanceCount > 0 && (
            <>
              <span aria-hidden="true">·</span>
              <span>{maintenanceCount} maintenance</span>
            </>
          )}
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1">
            <Input
              type="number"
              min={1}
              max={20}
              aria-label="Number of lanes to add"
              value={addCount}
              onChange={(e) => setAddCount(Math.max(1, Math.min(20, parseInt(e.target.value) || 1)))}
              className="h-9 w-16"
            />
            <Button
              size="sm"
              variant="outline"
              onClick={handleAddLanes}
              disabled={actionLoading === 'add'}
            >
              <Plus className="mr-1 h-4 w-4" />
              Add lane{addCount === 1 ? '' : 's'}
            </Button>
          </div>

          <Button
            size="sm"
            variant="outline"
            onClick={handleAutoAssign}
            disabled={actionLoading === 'auto-assign'}
          >
            <Play className="mr-1 h-4 w-4" />
            Auto-Assign
          </Button>

          <Button
            size="icon-sm"
            variant="ghost"
            onClick={fetchLanes}
            disabled={loading}
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            <span className="sr-only">Refresh lanes</span>
          </Button>
        </div>
      </div>

      {/* Lane list */}
      {lanes.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-muted-foreground">No lanes yet. Add lanes to get started.</p>
        </div>
      ) : (
        <div className="flex flex-col divide-y divide-muted rounded-2xl border bg-card">
          {lanes.map((lane) => {
            const state = laneState(lane);
            return (
            <div
              key={lane.id}
              data-state={lane.status}
              className="flex flex-wrap items-center gap-x-4 gap-y-3 px-5 py-3.5"
            >
              <span
                className={cn(
                  'flex size-11 flex-none items-center justify-center rounded-[10px] font-score text-[22px] leading-none font-bold',
                  state.tile
                )}
                aria-hidden="true"
              >
                {lane.label.replace(/^Lane\s*/i, '')}
              </span>
              <div className="flex min-w-0 flex-[1_1_200px] flex-col gap-0.5">
                <span className="text-[15px] font-semibold">{lane.label}</span>
                <span className={cn('text-[13px] font-semibold', state.tone)}>
                  {state.label}
                  {lane.maintenance_pending && (
                    <span className="text-warning"> · Maintenance after this match</span>
                  )}
                </span>
              </div>

              <div className="ml-auto flex flex-wrap items-center gap-1.5">
                {lane.status === 'idle' && (
                  <>
                    <Input
                      type="number"
                      placeholder="Match #"
                      value={assignMatchIds[lane.id] || ''}
                      onChange={(e) =>
                        setAssignMatchIds((prev) => ({ ...prev, [lane.id]: e.target.value }))
                      }
                      aria-label={`Match number for ${lane.label}`}
                      className="h-9 w-24 text-sm md:text-sm"
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleAssignLane(lane.id)}
                      disabled={actionLoading === lane.id || !assignMatchIds[lane.id]}
                    >
                      <Link className="mr-1 h-3 w-3" />
                      Assign
                    </Button>
                  </>
                )}

                {lane.status === 'occupied' && lane.current_match_id && (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleReleaseLane(lane.id, lane.current_match_id!)}
                      disabled={actionLoading === lane.id}
                    >
                      <Unlock className="mr-1 h-3 w-3" />
                      Release
                    </Button>
                    {lane.current_match_status === MatchStatus.Running ? (
                      <>
                        {lane.maintenance_pending ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleSetIdle(lane.id)}
                            disabled={actionLoading === lane.id}
                          >
                            Cancel
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleSetMaintenance(lane.id, 'after_match')}
                            disabled={actionLoading === lane.id}
                          >
                            <Wrench className="mr-1 h-3 w-3" />
                            After this match
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleSetMaintenance(lane.id, 'now')}
                          disabled={actionLoading === lane.id}
                        >
                          <Wrench className="mr-1 h-3 w-3" />
                          Now (stops scoring on this lane)
                        </Button>
                      </>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleSetMaintenance(lane.id)}
                        disabled={actionLoading === lane.id}
                      >
                        <Wrench className="mr-1 h-3 w-3" />
                        Maintenance
                      </Button>
                    )}
                  </>
                )}

                {lane.status === 'idle' && (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleSetMaintenance(lane.id)}
                      disabled={actionLoading === lane.id}
                    >
                      <Wrench className="mr-1 h-3 w-3" />
                      Maintenance
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => handleDeleteLane(lane.id)}
                      disabled={actionLoading === lane.id}
                    >
                      <Trash2 className="h-4 w-4" />
                      <span className="sr-only">Delete {lane.label}</span>
                    </Button>
                  </>
                )}

                {lane.status === 'maintenance' && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleSetIdle(lane.id)}
                    disabled={actionLoading === lane.id}
                  >
                    <Play className="mr-1 h-3 w-3" />
                    Activate
                  </Button>
                )}
              </div>
            </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
