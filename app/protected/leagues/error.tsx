'use client'

import { useEffect } from 'react'
import { Button } from '@/components/ui/button'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('Leagues page error:', error)
  }, [error])

  return (
    <div className="container mx-auto p-4">
      <div className="rounded-lg border bg-card text-card-foreground shadow-sm p-6">
        <h2 className="text-2xl font-bold mb-4">Something went wrong!</h2>
        <p className="text-muted-foreground mb-6">
          We couldn't load the leagues. Please try again or contact support if the problem persists.
        </p>
        <div className="flex space-x-4">
          <Button variant="outline" onClick={() => reset()}>
            Try again
          </Button>
          <Button variant="outline" asChild>
            <a href="/">Go to home</a>
          </Button>
        </div>
      </div>
    </div>
  )
}
