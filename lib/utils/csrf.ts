import 'server-only';
import { ForbiddenError } from '@/lib/errors';

/**
 * Validates Origin header against Host to prevent CSRF attacks.
 * Should be called for state-changing requests (POST, PUT, DELETE, PATCH).
 * @param request - The incoming request
 * @throws ForbiddenError if Origin doesn't match Host
 */
export function validateCsrfOrigin(request: Request): void {
  const origin = request.headers.get('origin');
  const host = request.headers.get('host');

  if (!origin) {
    throw new ForbiddenError('Missing origin header');
  }

  if (!host) {
    throw new ForbiddenError('Missing host header');
  }

  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new ForbiddenError('Invalid origin header');
  }

  if (originHost !== host) {
    throw new ForbiddenError('Origin mismatch');
  }
}
