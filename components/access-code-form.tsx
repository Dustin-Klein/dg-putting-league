'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils/utils';

/**
 * The event access-code entry that starts scoring (ScoreEntry.dc.html). Used on
 * /score and on the home page.
 */
export function AccessCodeForm({
  label = 'Access code',
  submitLabel = 'Enter',
  autoFocus = false,
  initialCode,
  className,
}: {
  /** Pre-filled and submitted on mount (from the presentation-mode QR code). */
  initialCode?: string;
  label?: string;
  submitLabel?: string;
  autoFocus?: boolean;
  className?: string;
}) {
  const router = useRouter();
  const [accessCode, setAccessCode] = useState(initialCode ?? '');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const autoSubmitted = useRef(false);

  const submitCode = async (code: string) => {
    setError(null);
    setIsLoading(true);

    try {
      const response = await fetch('/api/score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ access_code: code }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Invalid access code');
      }

      const data = await response.json();

      // Store access code for subsequent requests
      sessionStorage.setItem('scoring_access_code', code);

      // Navigate based on mode
      if (data.mode === 'qualification') {
        router.push('/score/qualification');
      } else {
        router.push('/score/matches');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to validate access code');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void submitCode(accessCode);
  };

  useEffect(() => {
    // Ref guard: StrictMode runs mount effects twice.
    if (!initialCode || autoSubmitted.current) return;
    autoSubmitted.current = true;
    void submitCode(initialCode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialCode]);

  return (
    <form onSubmit={handleSubmit} className={cn('flex flex-col gap-3', className)}>
      <Label htmlFor="accessCode" className="text-[15px]">{label}</Label>
      <Input
        id="accessCode"
        type="text"
        placeholder="Enter code"
        value={accessCode}
        onChange={(e) => setAccessCode(e.target.value)}
        className="h-[72px] rounded-[14px] border-2 px-4 text-center font-score text-4xl font-bold tracking-[0.12em] placeholder:text-2xl placeholder:tracking-normal md:text-4xl"
        autoComplete="off"
        autoFocus={autoFocus}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? 'accessCode-error' : undefined}
      />

      {error && (
        <p id="accessCode-error" className="text-sm text-destructive">{error}</p>
      )}

      <Button
        type="submit"
        className="h-14 w-full rounded-[14px] text-[17px]"
        disabled={!accessCode || isLoading}
      >
        {isLoading ? 'Verifying...' : submitLabel}
        {!isLoading && <ArrowRight className="size-[18px]" aria-hidden="true" />}
      </Button>
    </form>
  );
}
