'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { LeagueForm, type FormValues } from './LeagueForm';

export function CreateLeagueDialog() {
  const [open, setOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();
  const { toast } = useToast();

  const handleSubmit = async (values: FormValues) => {
    setIsLoading(true);

    try {
      const response = await fetch('/api/league', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: values.name.trim(),
          city: values.city.trim() || null,
          description: values.description?.trim() || null,
        }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data?.error || 'Failed to create league');
      }

      if (!data?.id) {
        throw new Error('Missing league ID in response');
      }

      setOpen(false);
      router.push(`/admin/leagues/${data.id}`);

      return data;
    } catch (error) {
      console.error('Error creating league:', error);
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to create league. Please try again.'
      });
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      <Button onClick={() => setOpen(true)}>Create League</Button>
      <Dialog open={open} onOpenChange={(next) => !isLoading && setOpen(next)}>
        <DialogContent
          className="bg-background sm:max-w-2xl"
          onInteractOutside={(event) => event.preventDefault()}
        >
          <DialogHeader className="text-left">
            <DialogTitle className="text-xl">Create New League</DialogTitle>
            <DialogDescription>Fill in the details below to create a new league.</DialogDescription>
          </DialogHeader>

          <LeagueForm
            onSubmit={handleSubmit}
            onCancel={() => setOpen(false)}
            isLoading={isLoading}
            submitButtonText="Create League"
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
