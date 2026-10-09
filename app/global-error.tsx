'use client'

import { useEffect } from 'react'

// Replaces the root layout when it fails, so it renders its own <html> and <body>
// and can't rely on the app's providers or styles.
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  useEffect(() => {
    // Server errors are logged with this digest by instrumentation.ts (onRequestError).
    console.error('Root layout error:', error)
  }, [error])

  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem' }}>
        <h2>Something went wrong</h2>
        <p>
          Please try again. If the problem persists, contact the league organizer
          {error.digest ? <> and mention error code <code>{error.digest}</code></> : null}.
        </p>
        <button type="button" onClick={() => retry()}>
          Try again
        </button>
      </body>
    </html>
  )
}
