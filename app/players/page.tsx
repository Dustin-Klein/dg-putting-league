'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { ChevronRight, Search, User } from 'lucide-react';
import { Input } from '@/components/ui/input';
import type { PlayerSearchResult } from '@/lib/types/player';

export default function PlayersPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [results, setResults] = useState<PlayerSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  const searchPlayers = useCallback(async (query: string, signal: AbortSignal) => {
    if (!query.trim()) {
      setResults([]);
      setHasSearched(false);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const response = await fetch(
        `/api/players/search?query=${encodeURIComponent(query.trim())}`,
        { signal }
      );

      if (!response.ok) {
        throw new Error('Failed to search players');
      }

      const data = await response.json();
      if (signal.aborted) return;
      setResults(data.results || []);
      setHasSearched(true);
    } catch (error) {
      if (signal.aborted) return;
      console.error('Search error:', error);
      setResults([]);
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, []);

  // Each new query cancels the previous one, so a slow older response never replaces newer results.
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      searchPlayers(searchQuery, controller.signal);
    }, 300);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [searchQuery, searchPlayers]);

  return (
    <div className="max-w-[880px] mx-auto px-4 pt-10 pb-14 md:px-6 flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <h1 className="font-score text-5xl leading-none font-bold">Players</h1>
        <p className="text-base text-muted-foreground">
          Search for players by name or player number
        </p>
      </div>

      <div className="relative">
        <label htmlFor="player-search" className="sr-only">Search players</label>
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 size-5 text-muted-foreground" aria-hidden="true" />
        <Input
          id="player-search"
          type="search"
          placeholder="Search players..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="h-14 rounded-[14px] pl-12 text-[17px] md:text-[17px]"
        />
      </div>

      {loading && (
        <div className="text-center py-8">
          <div className="animate-pulse">
            <div className="h-8 bg-muted rounded w-48 mx-auto"></div>
          </div>
        </div>
      )}

      {!loading && hasSearched && results.length === 0 && (
        <div className="text-center py-8">
          <User className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <p className="text-muted-foreground">No players found</p>
        </div>
      )}

      {!loading && results.length > 0 && (
        <>
          <span className="text-[13px] text-muted-foreground" aria-live="polite">
            {results.length} {results.length === 1 ? 'player matches' : 'players match'} “{searchQuery.trim()}”
          </span>
          <ul className="bg-card rounded-2xl border divide-y divide-muted overflow-hidden">
            {results.map((player) => {
              const content = (
                <>
                  <span className="w-14 shrink-0 font-score text-[22px] font-bold text-muted-foreground tabular-nums">
                    {player.player_number ? `#${player.player_number}` : '–'}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-base font-semibold">{player.full_name}</span>
                  {player.player_number && (
                    <ChevronRight className="size-[18px] shrink-0 text-muted-foreground" aria-hidden="true" />
                  )}
                </>
              );
              return (
                <li key={player.id}>
                  {player.player_number ? (
                    <Link
                      href={`/player/${player.player_number}`}
                      className="flex min-h-14 items-center gap-4 px-5 py-3.5 transition-colors hover:bg-muted/60"
                    >
                      {content}
                    </Link>
                  ) : (
                    <div className="flex min-h-14 items-center gap-4 px-5 py-3.5">{content}</div>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}

      {!loading && !hasSearched && (
        <div className="text-center py-8">
          <Search className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <p className="text-muted-foreground">
            Enter a name or player number to search
          </p>
        </div>
      )}
    </div>
  );
}
