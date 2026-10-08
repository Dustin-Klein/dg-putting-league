/**
 * Origin check used for CSRF protection. Kept free of `server-only` so the
 * proxy (middleware) can import it.
 *
 * @returns null if the request's Origin matches its Host, otherwise the reason it doesn't
 */
export function getOriginMismatchReason(request: Request): string | null {
  const origin = request.headers.get('origin');
  const host = request.headers.get('host');

  if (!origin) {
    return 'Missing origin header';
  }

  if (!host) {
    return 'Missing host header';
  }

  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return 'Invalid origin header';
  }

  if (originHost !== host) {
    return 'Origin mismatch';
  }

  return null;
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Whether a request is a state-changing API call that must pass the origin check.
 */
export function requiresCsrfCheck(method: string, pathname: string): boolean {
  return !SAFE_METHODS.has(method.toUpperCase()) && /^\/api(?:\/|$)/.test(pathname);
}
