'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'

export default function Error({
  error,
  retry,
}: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  useEffect(() => {
    // Server errors are logged with this digest by instrumentation.ts (onRequestError).
    console.error('Page error:', error)
  }, [error])

  return (
    <div className="container mx-auto p-4">
      <div className="rounded-lg border bg-card text-card-foreground shadow-xs p-6">
        <h2 className="text-2xl font-bold mb-4">Something went wrong</h2>
        <p className="text-muted-foreground mb-6">
          Please try again. If the problem persists, contact the league organizer
          {error.digest ? <> and mention error code <code>{error.digest}</code></> : null}.
        </p>
        <div className="flex space-x-4">
          <Button variant="outline" onClick={() => retry()}>
            Try again
          </Button>
          <Button variant="outline" asChild>
            <Link href="/">Go to home</Link>
          </Button>
        </div>
      </div>
    </div>
  )
}
