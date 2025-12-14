'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
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
      const response = await fetch('/api/leagues', {
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
        throw new Error(data.error || 'Failed to create league');
      }
      
      toast({
        title: 'Success',
        description: 'League created successfully!',
      });

      setOpen(false);
      if (data.id) {
        router.push(`/leagues/${data.id}`);
      }
      router.refresh();
    } catch (error: any) {
      console.error('Error creating league:', error);
      toast({
        title: 'Error',
        description: error?.message || 'Failed to create league. Please try again.'
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      <Button onClick={() => setOpen(true)}>Create League</Button>
      {open && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-background p-6 rounded-lg w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto">
            <h2 className="text-xl font-bold mb-4">Create New League</h2>
            <p className="text-muted-foreground mb-6">
              Fill in the details below to create a new league.
            </p>
            
            <LeagueForm
              onSubmit={handleSubmit}
              onCancel={() => setOpen(false)}
              isLoading={isLoading}
              submitButtonText="Create League"
            />
          </div>
        </div>
      )}
    </>
  );
}
