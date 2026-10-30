'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { StatusBadge } from '@/components/status-badge';
import { useToast } from '@/components/ui/use-toast';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { Trash2, UserPlus, Loader2 } from 'lucide-react';

interface LeagueAdmin {
  userId: string;
  email: string;
  role: string;
}

interface AdminManagementProps {
  leagueId: string;
}

export function AdminManagement({ leagueId }: AdminManagementProps) {
  const [admins, setAdmins] = useState<LeagueAdmin[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [removingUserId, setRemovingUserId] = useState<string | null>(null);
  const { toast } = useToast();

  const fetchAdmins = useCallback(async () => {
    try {
      const response = await fetch(`/api/league/${leagueId}/admins`);
      if (!response.ok) {
        throw new Error('Failed to fetch admins');
      }
      const data = await response.json();
      setAdmins(data.admins);
    } catch (error) {
      console.error('Error fetching admins:', error);
      toast({
        title: 'Error',
        description: 'Failed to load admins',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  }, [leagueId, toast]);

  useEffect(() => {
    fetchAdmins();
  }, [fetchAdmins]);

  const handleAddAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      const response = await fetch(`/api/league/${leagueId}/admins`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data?.error || 'Failed to add admin');
      }
      setEmail('');
      setDialogOpen(false);
      await fetchAdmins();
    } catch (error) {
      console.error('Error adding admin:', error);
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to add admin',
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRemoveAdmin = async (userId: string) => {
    setRemovingUserId(userId);

    try {
      const response = await fetch(`/api/league/${leagueId}/admins/${userId}`, {
        method: 'DELETE',
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data?.error || 'Failed to remove admin');
      }
      await fetchAdmins();
    } catch (error) {
      console.error('Error removing admin:', error);
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to remove admin',
        variant: 'destructive',
      });
    } finally {
      setRemovingUserId(null);
    }
  };

  if (isLoading) {
    return (
      <aside className="rounded-2xl border bg-card p-5">
        <h2 className="text-lg font-bold mb-4">League Admins</h2>
        <div className="flex items-center justify-center py-4">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </aside>
    );
  }

  return (
    <aside className="rounded-2xl border bg-card p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-bold">League Admins</h2>
        <Button size="sm" onClick={() => setDialogOpen(true)}>
          <UserPlus className="h-4 w-4 mr-1" />
          Add Admin
        </Button>
      </div>

      <div className="flex flex-col divide-y divide-muted">
        {admins.map((admin) => (
          <div
            key={admin.userId}
            className="flex min-h-12 items-center justify-between gap-2 py-2"
          >
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate text-sm">{admin.email}</span>
              <StatusBadge tone={admin.role === 'owner' ? 'neutral' : 'outline'} className="capitalize">
                {admin.role}
              </StatusBadge>
            </div>
            {admin.role !== 'owner' && (
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => handleRemoveAdmin(admin.userId)}
                disabled={removingUserId === admin.userId}
              >
                {removingUserId === admin.userId ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4 text-destructive" />
                )}
              </Button>
            )}
          </div>
        ))}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add League Admin</DialogTitle>
            <DialogDescription>
              Enter the email address of an existing user to add them as an admin.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleAddAdmin}>
            <div className="py-4">
              <Input
                type="email"
                placeholder="Email address"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setDialogOpen(false)}
                disabled={isSubmitting}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting || !email.trim()}>
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-1" />
                    Adding...
                  </>
                ) : (
                  'Add Admin'
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </aside>
  );
}
