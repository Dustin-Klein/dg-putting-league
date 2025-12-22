'use client';

import { useState, useCallback, useRef } from 'react';
import { useDebounce } from 'use-debounce';
import { Search, Plus, X, Loader2, UserPlus, CheckCircle2, CircleDollarSign } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/use-toast';
import { EventWithDetails, AddPlayerFormValues } from '../types';
import { format } from 'date-fns';
import { TeamDisplay } from './team-display';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

export function PlayerManagement({ 
  event, 
  isAdmin 
}: { 
  event: EventWithDetails; 
  isAdmin: boolean;
}) {
  const { toast } = useToast();
  
  console.log('PlayerManagement - isAdmin:', isAdmin);
  console.log('PlayerManagement - event.status:', event.status);
  console.log('PlayerManagement - should show button:', isAdmin && event.status === 'pre-bracket');
  
  const [players, setPlayers] = useState(event.players ?? []);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery] = useDebounce(searchQuery, 300);
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<{id: string; name: string; identifier: string}[]>([]);
  const [isAddingPlayer, setIsAddingPlayer] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  // Handle search input change
  const handleSearch = useCallback(async (query: string) => {
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }

    try {
      setIsSearching(true);
      const searchParams = new URLSearchParams({
        query,
        excludeEventId: event.id
      });
      const response = await fetch(`/api/players/search?${searchParams.toString()}`);
      
      if (!response.ok) {
        throw new Error('Search failed');
      }

      const data = await response.json();
      // Map the API response to match the expected format
      const mappedResults = (data.results || []).map((player: any) => ({
        id: player.id,
        name: player.full_name || 'Unknown Player',
        identifier: player.player_number ? `#${player.player_number}` : '',
        player_number: player.player_number
      }));
      setSearchResults(mappedResults);
    } catch (error) {
      console.error('Search error:', error);
      toast({
        title: 'Error',
        description: 'Failed to search for players',
      });
    } finally {
      setIsSearching(false);
    }
  }, [toast]);

  // Handle adding a player to the event
  const handleAddPlayer = async (playerId: string) => {
  try {
    setIsAddingPlayer(true);
    const response = await fetch(`/api/event/${event.id}/players/${playerId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error || 'Failed to add player');
    }
    // Update state with returned event player
    if (data?.data) {
      setPlayers((prev) => [...prev, data.data]);
    }
  } catch (error) {
    console.error('Error adding player:', error);
    toast({
      title: 'Error',
      description: error instanceof Error ? error.message : 'Failed to add player to event'
    });
  } finally {
    setIsAddingPlayer(false);
  }
};

  // Reset form when dialog is closed
  const handleDialogOpenChange = (open: boolean) => {
    if (!open) {
      setSearchQuery('');
      setSearchResults([]);
      setShowAddForm(false);
    }
    setIsDialogOpen(open);
  };

  // Handle creating a new player and adding to the event
  const handleCreatePlayer = async (formData: FormData) => {
    try {
      setIsAddingPlayer(true);
      
      // Convert FormData to JSON
      const playerData = {
        name: formData.get('name')?.toString(),
        identifier: formData.get('identifier')?.toString(),
        email: formData.get('email')?.toString(),
      };

      const response = await fetch(`/api/players`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(playerData),
      });

      const responseData = await response.json();
      
      if (!response.ok) {
        // If player already exists, use their ID
        if (response.status === 400 && responseData.playerId) {
          await handleAddPlayer(responseData.playerId);
          setIsDialogOpen(false);
          return;
        }
        throw new Error(responseData.error || 'Failed to create player');
      }

      const { playerId } = responseData;
      await handleAddPlayer(playerId);
      
      toast({
        title: 'Success',
        description: 'Player added successfully',
      });
      
      setIsDialogOpen(false);
    } catch (error) {
      console.error('Error creating player:', error);
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to create new player',
      });
      throw error; // Re-throw to be caught by the form's onSubmit
    } finally {
      setIsAddingPlayer(false);
      setShowAddForm(false);
      setSearchQuery('');
    }
  };

  // Handle removing a player from the event
  const handleRemovePlayer = async (eventPlayerId: string) => {
    if (!confirm('Are you sure you want to remove this player from the event?')) {
      return;
    }

    try {
      const response = await fetch(`/api/event/${event.id}/players/${eventPlayerId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error('Failed to remove player');
      }

      // Update UI without refresh
      setPlayers((prev) => prev.filter((p) => p.id !== eventPlayerId));
    } catch (error) {
      console.error('Error removing player:', error);
      toast({
        title: 'Error',
        description: 'Failed to remove player from event',
      });
    }
  };

  // Handle toggling payment status
  const handleTogglePayment = async (eventPlayerId: string, playerId: string, currentStatus: boolean) => {
    try {
      const response = await fetch(`/api/event/${event.id}/players/${playerId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hasPaid: !currentStatus })
      });

      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Failed to update payment status');
      }

      // Update the UI without refreshing
      const updatedPlayers = players.map(player => 
        player.id === eventPlayerId 
          ? { ...player, has_paid: !currentStatus } 
          : player
      );
      setPlayers(updatedPlayers);
    } catch (error) {
      console.error('Error updating payment status:', error);
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to update payment status'
      });
    }
  };

  return (
    <div className="space-y-6">
      {/* Show teams if event is in bracket status */}
      {event.status === 'bracket' ? (
        <TeamDisplay event={event} isAdmin={isAdmin} />
      ) : (
        <>
          <div className="flex justify-between items-center">
            <h2 className="text-2xl font-bold">Players</h2>
            {isAdmin && event.status === 'pre-bracket' && (
              <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                <DialogTrigger asChild>
                  <Button>
                    <UserPlus className="mr-2 h-4 w-4" />
                    Add Player
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-[500px]">
                  <DialogHeader>
                    <DialogTitle>Add Player to Event</DialogTitle>
                  </DialogHeader>
                  <div className="relative mt-4">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      type="search"
                      placeholder="Search players..."
                      className="pl-10"
                      value={searchQuery}
                      onChange={(e) => {
                        const query = e.target.value;
                        setSearchQuery(query);
                        handleSearch(query);
                      }}
                    />
                    {isSearching && (
                      <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
                    )}
                  </div>
                  
                  {searchQuery && !isSearching && searchResults.length === 0 && (
                    <div className="mt-4 p-4 bg-muted/50 rounded-md">
                      <p className="text-sm text-muted-foreground mb-4">
                        No players found. Would you like to add a new player?
                      </p>
                      <Button 
                        variant="outline" 
                        className="w-full"
                        onClick={() => setShowAddForm(true)}
                      >
                        <Plus className="mr-2 h-4 w-4" />
                        Add New Player
                      </Button>
                    </div>
                  )}
                  
                  {searchQuery && !isSearching && searchResults.length > 0 && (
                    <div className="mt-4 space-y-2 max-h-60 overflow-y-auto">
                      {searchResults.map((player) => (
                        <div 
                          key={player.id}
                          className="flex items-center justify-between p-3 rounded-md border hover:bg-accent cursor-pointer"
                          onClick={() => {
                            handleAddPlayer(player.id);
                            setIsDialogOpen(false);
                          }}
                        >
                          <div>
                            <div className="font-medium">{player.name}</div>
                            <div className="text-xs text-muted-foreground">{player.identifier}</div>
                          </div>
                          <Plus className="h-4 w-4 text-muted-foreground" />
                        </div>
                      ))}
                    </div>
                  )}
                  {showAddForm && (
                    <div className="mt-4 bg-card border rounded-lg p-4">
                      <div className="flex justify-between items-center mb-4">
                        <h3 className="font-medium">Add New Player</h3>
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          onClick={() => {
                            setShowAddForm(false);
                            setSearchQuery('');
                          }}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                      <form ref={formRef} onSubmit={async (e) => {
                        e.preventDefault();
                        const formData = new FormData(e.currentTarget);
                        const name = formData.get('name')?.toString().trim();
                        const email = formData.get('email')?.toString().trim();
                        
                        // Basic validation
                        if (!name) {
                          toast({
                            title: 'Error',
                            description: 'Name is required',
                          });
                          return;
                        }

                        if (!email) {
                          toast({
                            title: 'Error',
                            description: 'Email is required',
                          });
                          return;
                        }

                        // Simple email validation
                        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                          toast({
                            title: 'Error',
                            description: 'Please enter a valid email address',
                          });
                          return;
                        }
                        
                        try {
                          await handleCreatePlayer(formData);
                        } catch (error) {
                          console.error('Form submission error:', error);
                        }
                      }} className="space-y-4">
                        <div className="space-y-4">
                          <div>
                            <label htmlFor="name" className="text-sm font-medium mb-1 block">
                              Full Name <span className="text-destructive">*</span>
                            </label>
                            <Input
                              id="name"
                              name="name"
                              placeholder="Player's full name"
                              required
                            />
                          </div>
                          <div>
                            <label htmlFor="email" className="text-sm font-medium mb-1 block">
                              Email <span className="text-destructive">*</span>
                            </label>
                            <Input
                              id="email"
                              name="email"
                              type="email"
                              placeholder="player@example.com"
                              required
                            />
                          </div>
                        </div>
                        <div className="flex justify-end space-x-2 pt-2">
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => {
                              setShowAddForm(false);
                              setSearchQuery('');
                            }}
                            disabled={isAddingPlayer}
                          >
                            Cancel
                          </Button>
                          <Button type="submit" disabled={isAddingPlayer}>
                            {isAddingPlayer && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Add Player
                          </Button>
                        </div>
                      </form>
                    </div>
                  )}
                </DialogContent>
              </Dialog>
            )}
          </div>

          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Identifier</TableHead>
                  <TableHead>Registered</TableHead>
                  <TableHead>Paid</TableHead>
                  {isAdmin && <TableHead className="w-[100px]">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {players && players.length > 0 ? (
                  players.map((eventPlayer) => (
                    <TableRow key={eventPlayer.id}>
                      <TableCell className="font-medium">
                        {eventPlayer.player.full_name}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {eventPlayer.player.player_number ? `#${eventPlayer.player.player_number}` : 'N/A'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {format(new Date(eventPlayer.created_at), 'MMM d, yyyy')}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleTogglePayment(eventPlayer.id, eventPlayer.player.id, eventPlayer.has_paid)}
                          disabled={!isAdmin || event.status !== 'pre-bracket'}
                          className="p-0 h-auto"
                        >
                          {eventPlayer.has_paid ? (
                            <CheckCircle2 className="h-5 w-5 text-green-500" />
                          ) : (
                            <CircleDollarSign className="h-5 w-5 text-muted-foreground" />
                          )}
                          <span className="sr-only">
                            {eventPlayer.has_paid ? 'Mark as unpaid' : 'Mark as paid'}
                          </span>
                        </Button>
                      </TableCell>
                      {isAdmin && event.status === 'pre-bracket' && (
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleRemovePlayer(eventPlayer.id)}
                            disabled={isAddingPlayer}
                          >
                            <X className="h-4 w-4" />
                            <span className="sr-only">Remove</span>
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={isAdmin && event.status === 'pre-bracket' ? 4 : 3} className="h-24 text-center">
                      No players registered yet.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </div>
  );
}
