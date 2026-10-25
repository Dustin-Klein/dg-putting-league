'use client'

import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ui/use-toast';
import { LeagueForm, type FormValues } from '../components/LeagueForm';

export function CreateLeagueForm() {
  const router = useRouter();
  const { toast } = useToast();

  const handleSubmit = async (values: FormValues) => {
    try {
      const response = await fetch('/api/league', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: values.name.trim(),
          city: values.city.trim(),
        }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data?.error || 'Failed to create league');
      }

      // Redirect to the new league's page
      router.push(`/admin/leagues/${data.id}`);
      router.refresh();

      return data;
    } catch (error) {
      console.error('Error creating league:', error);
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to create league. Please try again.',
      });
      throw error;
    }
  };

  return (
    <LeagueForm
      onSubmit={handleSubmit}
      onCancel={() => router.back()}
      submitButtonText="Create League"
    />
  );
}
