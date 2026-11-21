'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2, Search, UserPlus, X } from 'lucide-react';
import { useDebouncedCallback } from 'use-debounce';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils/utils';

export interface PickedPlayer {
  id: string;
  full_name: string;
  player_number: number | null;
}

/**
 * Search the league's players (leaving out anyone already in the event), or create a
 * new one, and pick one.
 */
export function PlayerPicker({
  eventId,
  value,
  onChange,
  exclude = [],
  label,
  id,
}: {
  eventId: string;
  value: PickedPlayer | null;
  onChange: (player: PickedPlayer | null) => void;
  /** Players picked elsewhere in the same form. */
  exclude?: string[];
  label: string;
  id: string;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PickedPlayer[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newPlayer, setNewPlayer] = useState({ name: '', email: '', pool: 'B' as 'A' | 'B' });
  const controllerRef = useRef<AbortController | null>(null);
  useEffect(() => () => controllerRef.current?.abort(), []);

  const search = useDebouncedCallback(async (text: string) => {
    controllerRef.current?.abort();
    if (!text.trim()) {
      setResults([]);
      setSearching(false);
      return;
    }
    const controller = new AbortController();
    controllerRef.current = controller;
    try {
      setSearching(true);
      const params = new URLSearchParams({ query: text, excludeEventId: eventId });
      const response = await fetch(`/api/players/search?${params}`, { signal: controller.signal });
      if (!response.ok) throw new Error('Search failed');
      const data = await response.json();
      if (controller.signal.aborted) return;
      setResults((data.results ?? []).map((p: PickedPlayer) => ({
        id: p.id,
        full_name: p.full_name,
        player_number: p.player_number ?? null,
      })));
      setError(null);
    } catch {
      if (!controller.signal.aborted) setError('Search failed. Try again.');
    } finally {
      if (!controller.signal.aborted) setSearching(false);
    }
  }, 300);

  const createPlayer = async () => {
    if (!newPlayer.name.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newPlayer.email.trim())) {
      setError('Enter a name and a valid email');
      return;
    }
    try {
      setSaving(true);
      const response = await fetch('/api/players', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newPlayer.name.trim(), email: newPlayer.email.trim(), default_pool: newPlayer.pool }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not create the player');
      onChange({ id: data.playerId, full_name: newPlayer.name.trim(), player_number: null });
      setCreating(false);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the player');
    } finally {
      setSaving(false);
    }
  };

  if (value) {
    return (
      <div className="flex flex-col gap-1.5">
        <span className="text-[13px] font-semibold">{label}</span>
        <div className="flex items-center justify-between gap-3 rounded-[10px] border bg-muted/40 px-3 py-2.5">
          <span className="flex flex-col">
            <span className="text-[15px] font-semibold">{value.full_name}</span>
            <span className="text-xs text-muted-foreground">
              {value.player_number != null ? `#${value.player_number} · ` : ''}not in this event yet
            </span>
          </span>
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)} aria-label={`Change ${label.toLowerCase()}`}>
            <X className="size-4" />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[13px] font-semibold">{label}</label>
      {creating ? (
        <div className="flex flex-col gap-2 rounded-[10px] border p-3">
          <Input
            placeholder="Full name"
            value={newPlayer.name}
            onChange={(e) => setNewPlayer({ ...newPlayer, name: e.target.value })}
            aria-label="New player's full name"
          />
          <Input
            type="email"
            placeholder="Email"
            value={newPlayer.email}
            onChange={(e) => setNewPlayer({ ...newPlayer, email: e.target.value })}
            aria-label="New player's email"
          />
          <div className="flex items-center gap-2 text-sm" role="radiogroup" aria-label="Default pool">
            <span className="text-muted-foreground">Default pool</span>
            {(['A', 'B'] as const).map((pool) => (
              <Button
                key={pool}
                type="button"
                size="sm"
                variant={newPlayer.pool === pool ? 'default' : 'outline'}
                role="radio"
                aria-checked={newPlayer.pool === pool}
                onClick={() => setNewPlayer({ ...newPlayer, pool })}
              >
                Pool {pool}
              </Button>
            ))}
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setCreating(false)} disabled={saving}>
              Back to search
            </Button>
            <Button type="button" size="sm" onClick={createPlayer} disabled={saving}>
              {saving && <Loader2 className="mr-1.5 size-4 animate-spin" />}
              Create player
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="relative">
            <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              id={id}
              type="search"
              placeholder="Search by name or number"
              className="pl-9"
              value={query}
              autoComplete="off"
              onChange={(e) => {
                setQuery(e.target.value);
                search(e.target.value);
              }}
            />
            {searching && <Loader2 className="absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />}
          </div>
          {results.filter((p) => !exclude.includes(p.id)).length > 0 && (
            <ul className="m-0 flex max-h-44 list-none flex-col overflow-auto rounded-[10px] border p-1">
              {results.filter((p) => !exclude.includes(p.id)).map((player) => (
                <li key={player.id}>
                  <button
                    type="button"
                    className={cn('flex w-full items-center justify-between rounded-md px-2.5 py-2 text-left text-sm hover:bg-muted')}
                    onClick={() => onChange(player)}
                  >
                    <span className="font-medium">{player.full_name}</span>
                    {player.player_number != null && <span className="text-xs text-muted-foreground">#{player.player_number}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <Button
            type="button"
            variant="link"
            size="sm"
            className="h-auto self-start p-0"
            onClick={() => {
              setNewPlayer({ name: query.trim(), email: '', pool: 'B' });
              setCreating(true);
            }}
          >
            <UserPlus className="mr-1 size-3.5" />
            New player
          </Button>
        </>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
