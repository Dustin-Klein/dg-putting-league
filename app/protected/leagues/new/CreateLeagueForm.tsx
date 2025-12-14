'use client'

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';

const formSchema = z.object({
  name: z.string().min(3, 'Name must be at least 3 characters'),
  city: z.string().min(2, 'City is required'),
  description: z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;

interface CreateLeagueFormProps {
  userId: string;
}

export function CreateLeagueForm({ userId }: CreateLeagueFormProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: '',
      city: '',
      description: '',
    },
  });

  async function onSubmit(values: FormValues) {
    try {
      setIsSubmitting(true);
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
      router.push(`/leagues/${data.id}`);
      router.refresh();
    } catch (error) {
      console.error('Error creating league:', error);
      toast({
        title: 'Error',
        description: 'Failed to create league. Please try again.',
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>League Name</FormLabel>
              <FormControl>
                <Input placeholder="e.g., Spring Putting League" {...field} />
              </FormControl>
              <FormDescription>
                This is your league's public display name.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="city"
          render={({ field }) => (
            <FormItem>
              <FormLabel>City</FormLabel>
              <FormControl>
                <Input placeholder="e.g., Portland" {...field} />
              </FormControl>
              <FormDescription>
                The city where the league is based.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Description (Optional)</FormLabel>
              <FormControl>
                <Textarea
                  placeholder="Tell us about your league..."
                  className="resize-none"
                  {...field}
                />
              </FormControl>
              <FormDescription>
                A brief description of your league (e.g., format, schedule, etc.)
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="flex justify-end space-x-4">
          <Button
            type="button"
            variant="outline"
            onClick={() => router.back()}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Creating...' : 'Create League'}
          </Button>
        </div>
      </form>
    </Form>
  );
}
