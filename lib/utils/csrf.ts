import 'server-only';
import { ForbiddenError } from '@/lib/errors';
import { getOriginMismatchReason } from './same-origin';

/**
 * Validates Origin header against Host to prevent CSRF attacks.
 * The proxy already applies this check to every state-changing /api request;
 * routes may still call it explicitly.
 * @param request - The incoming request
 * @throws ForbiddenError if Origin doesn't match Host
 */
export function validateCsrfOrigin(request: Request): void {
  const reason = getOriginMismatchReason(request);
  if (reason) {
    throw new ForbiddenError(reason);
  }
}
