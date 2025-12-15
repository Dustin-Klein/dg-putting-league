'use client';

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

export const formSchema = z.object({
  name: z.string().min(3, 'Name must be at least 3 characters'),
  city: z.string().min(2, 'City is required'),
  description: z.string().optional(),
});

export type FormValues = z.infer<typeof formSchema>;

interface LeagueFormProps {
  onSubmit: (values: FormValues) => Promise<void>;
  onCancel?: () => void;
  isLoading?: boolean;
  submitButtonText?: string;
  showCancelButton?: boolean;
  defaultValues?: Partial<FormValues>;
}

export function LeagueForm({
  onSubmit,
  onCancel,
  isLoading = false,
  submitButtonText = 'Submit',
  showCancelButton = true,
  defaultValues = { name: '', city: '', description: '' },
}: LeagueFormProps) {
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues,
  });

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
                <Input 
                  placeholder="e.g., Spring Putting League" 
                  {...field} 
                  disabled={isLoading}
                  className="text-foreground"
                />
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
                <Input 
                  placeholder="e.g., Portland" 
                  {...field} 
                  disabled={isLoading}
                  className="text-foreground"
                />
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
                  className="resize-none text-foreground"
                  {...field}
                  disabled={isLoading}
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
          {showCancelButton && onCancel && (
            <Button
              type="button"
              variant="outline"
              onClick={onCancel}
              disabled={isLoading}
            >
              Cancel
            </Button>
          )}
          <Button type="submit" disabled={isLoading}>
            {isLoading ? 'Submitting...' : submitButtonText}
          </Button>
        </div>
      </form>
    </Form>
  );
}
