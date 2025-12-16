'use client'

import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ui/use-toast';
import { LeagueForm, type FormValues } from '../components/LeagueForm';

interface CreateLeagueFormProps {
  userId: string;
}

export function CreateLeagueForm({ userId }: CreateLeagueFormProps) {
  const router = useRouter();
  const { toast } = useToast();

  const handleSubmit = async (values: FormValues) => {
    try {
      const response = await fetch('/api/leagues', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...values,
          userId,
        }),
      });

      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Failed to create league');
      }
      
      toast({
        title: 'Success',
        description: 'Your new league has been created successfully.',
      });

      // Redirect to the new league's page
      router.push(`/league/${data.id}`);
      router.refresh();
      
      return data;
    } catch (error) {
      console.error('Error creating league:', error);
      toast({
        title: 'Error',
        description: 'Failed to create league. Please try again.',
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
