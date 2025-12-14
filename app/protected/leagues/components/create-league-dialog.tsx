'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';

export function CreateLeagueDialog() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [city, setCity] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      const response = await fetch('/api/leagues', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name, city }),
      });

      if (!response.ok) {
        throw new Error('Failed to create league');
      }

      const data = await response.json();
      
      toast({
        title: 'Success',
        description: 'League created successfully!'
      });

      setOpen(false);
      router.refresh();
    } catch (error) {
      console.error('Error creating league:', error);
      toast({
        title: 'Error',
        description: 'Failed to create league. Please try again.',
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      <Button onClick={() => setOpen(true)}>Create League</Button>
      {open && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-lg w-full max-w-md mx-4">
            <h2 className="text-xl font-bold mb-4">Create New League</h2>
            <p className="text-gray-600 mb-6">
              Fill in the details below to create a new league.
            </p>
            
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="name" className="block text-sm font-medium text-gray-700">
                  League Name
                  <span className="text-red-500 ml-1">*</span>
                </Label>
                <div className="mt-1">
                  <Input
                    id="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g., Summer Disc Golf League"
                    className="w-full text-gray-900 bg-white"
                    required
                  />
                </div>
                <p className="mt-1 text-sm text-gray-500">
                  Enter a descriptive name for your league
                </p>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="city" className="block text-sm font-medium text-gray-700">
                  Location (City)
                  <span className="text-gray-400 text-xs ml-1">optional</span>
                </Label>
                <div className="mt-1">
                  <Input
                    id="city"
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    placeholder="e.g., Portland, OR"
                    className="w-full text-gray-900 bg-white"
                  />
                </div>
                <p className="mt-1 text-sm text-gray-500">
                  Where is your league primarily located?
                </p>
              </div>
              
              <div className="flex justify-end space-x-2 mt-6">
                <Button 
                  type="button" 
                  variant="outline" 
                  onClick={() => setOpen(false)}
                  disabled={isLoading}
                >
                  Cancel
                </Button>
                <Button 
                  type="submit" 
                  disabled={isLoading}
                >
                  {isLoading ? 'Creating...' : 'Create League'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
