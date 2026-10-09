/** Header carrying the per-request id set by the proxy (lib/supabase/proxy.ts). */
export const REQUEST_ID_HEADER = 'x-request-id';

/**
 * The id the proxy assigned to the current request, or undefined outside a
 * request scope (tests, scripts).
 */
export async function getRequestId(): Promise<string | undefined> {
  try {
    // Loaded lazily so the proxy and instrumentation can import REQUEST_ID_HEADER
    // without pulling in next/headers.
    const { headers } = await import('next/headers');
    return (await headers()).get(REQUEST_ID_HEADER) ?? undefined;
  } catch {
    return undefined;
  }
}
