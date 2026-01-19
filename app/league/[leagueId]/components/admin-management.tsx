'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
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

  const fetchAdmins = async () => {
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
  };

  useEffect(() => {
    fetchAdmins();
  }, [leagueId]);

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

      toast({
        title: 'Success',
        description: 'Admin added successfully',
      });
      setEmail('');
      setDialogOpen(false);
      fetchAdmins();
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

      toast({
        title: 'Success',
        description: 'Admin removed successfully',
      });
      fetchAdmins();
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
      <div className="border rounded-lg p-4 mt-6">
        <h2 className="text-lg font-semibold mb-4">League Admins</h2>
        <div className="flex items-center justify-center py-4">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  return (
    <div className="border rounded-lg p-4 mt-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">League Admins</h2>
        <Button size="sm" onClick={() => setDialogOpen(true)}>
          <UserPlus className="h-4 w-4 mr-1" />
          Add Admin
        </Button>
      </div>

      <div className="space-y-2">
        {admins.map((admin) => (
          <div
            key={admin.userId}
            className="flex items-center justify-between py-2 px-3 bg-muted/50 rounded-md"
          >
            <div className="flex items-center gap-2">
              <span className="text-sm">{admin.email}</span>
              <Badge variant={admin.role === 'owner' ? 'default' : 'secondary'}>
                {admin.role}
              </Badge>
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
    </div>
  );
}
