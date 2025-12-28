'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function ScorePage() {
  const router = useRouter();
  const [accessCode, setAccessCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      const response = await fetch('/api/score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ access_code: accessCode }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Invalid access code');
      }

      // Store access code and navigate to matches
      sessionStorage.setItem('scoring_access_code', accessCode);
      router.push(`/score/matches`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to validate access code');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Score Entry</CardTitle>
          <CardDescription>
            Enter the event access code to start scoring matches
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="accessCode">Access Code</Label>
              <Input
                id="accessCode"
                type="text"
                placeholder="Enter access code"
                value={accessCode}
                onChange={(e) => setAccessCode(e.target.value)}
                className="text-center text-lg"
                autoComplete="off"
                autoFocus
              />
            </div>

            {error && (
              <p className="text-sm text-destructive text-center">{error}</p>
            )}

            <Button
              type="submit"
              className="w-full"
              disabled={!accessCode || isLoading}
            >
              {isLoading ? 'Verifying...' : 'Enter'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
