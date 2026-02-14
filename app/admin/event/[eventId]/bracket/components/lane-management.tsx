'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { RefreshCw, Plus, Trash2, Wrench, Play, Unlock, Link } from 'lucide-react';
import type { LaneWithMatch } from '@/lib/types/bracket';

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

  const handleSetMaintenance = async (laneId: string) => {
    try {
      setActionLoading(laneId);
      const res = await fetch(`/api/event/${eventId}/lanes/${laneId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'maintenance' }),
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

  const handleReleaseLane = async (laneId: string, matchId: number) => {
    try {
      setActionLoading(laneId);
      const res = await fetch(`/api/event/${eventId}/lanes/${laneId}/release`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ matchId }),
      });
      if (!res.ok) {
        const data = await res.json();
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

  const statusBadge = (status: string) => {
    switch (status) {
      case 'idle':
        return <Badge className="bg-green-100 text-green-700 border-green-200">Idle</Badge>;
      case 'occupied':
        return <Badge className="bg-blue-100 text-blue-700 border-blue-200">Occupied</Badge>;
      case 'maintenance':
        return <Badge className="bg-yellow-100 text-yellow-700 border-yellow-200">Maintenance</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
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
    <div className="space-y-6">
      {/* Header bar */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>{lanes.length} total</span>
          <span>·</span>
          <span className="text-green-600">{idleCount} idle</span>
          <span>·</span>
          <span className="text-blue-600">{occupiedCount} occupied</span>
          {maintenanceCount > 0 && (
            <>
              <span>·</span>
              <span className="text-yellow-600">{maintenanceCount} maintenance</span>
            </>
          )}
        </div>

        <div className="flex items-center gap-2 ml-auto">
          <div className="flex items-center gap-1">
            <Input
              type="number"
              min={1}
              max={20}
              value={addCount}
              onChange={(e) => setAddCount(Math.max(1, Math.min(20, parseInt(e.target.value) || 1)))}
              className="w-16 h-9"
            />
            <Button
              size="sm"
              variant="outline"
              onClick={handleAddLanes}
              disabled={actionLoading === 'add'}
            >
              <Plus className="mr-1 h-4 w-4" />
              Add
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
            size="sm"
            variant="ghost"
            onClick={fetchLanes}
            disabled={loading}
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {/* Lane list */}
      {lanes.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-muted-foreground">No lanes yet. Add lanes to get started.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {lanes.map((lane) => (
            <div
              key={lane.id}
              className="flex items-center gap-3 rounded-lg border px-4 py-3"
            >
              <span className="font-medium text-sm w-16 shrink-0">{lane.label}</span>
              {statusBadge(lane.status)}

              {lane.status === 'occupied' && lane.current_match_id && (
                <span className="text-sm text-muted-foreground">
                  M{lane.current_match_number ?? lane.current_match_id}
                </span>
              )}

              <div className="flex items-center gap-2 ml-auto shrink-0">
                {lane.status === 'idle' && (
                  <>
                    <Input
                      type="number"
                      placeholder="Match #"
                      value={assignMatchIds[lane.id] || ''}
                      onChange={(e) =>
                        setAssignMatchIds((prev) => ({ ...prev, [lane.id]: e.target.value }))
                      }
                      className="w-24 h-8 text-xs"
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8"
                      onClick={() => handleAssignLane(lane.id)}
                      disabled={actionLoading === lane.id || !assignMatchIds[lane.id]}
                    >
                      <Link className="mr-1 h-3 w-3" />
                      Assign
                    </Button>
                  </>
                )}

                {lane.status === 'occupied' && lane.current_match_id && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleReleaseLane(lane.id, lane.current_match_id!)}
                    disabled={actionLoading === lane.id}
                  >
                    <Unlock className="mr-1 h-3 w-3" />
                    Release
                  </Button>
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
                      size="sm"
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      onClick={() => handleDeleteLane(lane.id)}
                      disabled={actionLoading === lane.id}
                    >
                      <Trash2 className="h-3 w-3" />
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
          ))}
        </div>
      )}
    </div>
  );
}
