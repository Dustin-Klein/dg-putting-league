'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Search, User } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { PlayerSearchResult } from '@/lib/types/player';

export default function PlayersPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [results, setResults] = useState<PlayerSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  const searchPlayers = useCallback(async (query: string) => {
    if (!query.trim()) {
      setResults([]);
      setHasSearched(false);
      return;
    }

    try {
      setLoading(true);
      const response = await fetch(
        `/api/players/search?query=${encodeURIComponent(query.trim())}`
      );

      if (!response.ok) {
        throw new Error('Failed to search players');
      }

      const data = await response.json();
      setResults(data.results || []);
      setHasSearched(true);
    } catch (error) {
      console.error('Search error:', error);
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      searchPlayers(searchQuery);
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery, searchPlayers]);

  return (
    <div className="max-w-4xl mx-auto py-8 px-4 space-y-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold">Players</h1>
        <p className="text-muted-foreground">
          Search for players by name or player number
        </p>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          type="text"
          placeholder="Search players..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-10"
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
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Player Number</TableHead>
                <TableHead>Name</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {results.map((player) => (
                <TableRow
                  key={player.id}
                  className={`relative group ${player.player_number ? 'cursor-pointer' : ''}`}
                >
                  <TableCell>
                    {player.player_number ? (
                      <Badge variant="secondary">#{player.player_number}</Badge>
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {player.player_number ? (
                      <Link
                        href={`/player/${player.player_number}`}
                        className="font-medium group-hover:underline after:absolute after:inset-0"
                      >
                        {player.full_name}
                      </Link>
                    ) : (
                      <span className="font-medium">{player.full_name}</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
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
