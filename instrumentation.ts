import type { Instrumentation } from 'next';
import { describeError, logger } from './lib/utils/logger';
import { REQUEST_ID_HEADER } from './lib/utils/request-id';

export function register() {
  // All server data access uses the direct Postgres connection; fail at startup
  // instead of on the first request.
  if (process.env.NODE_ENV === 'production' && !process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set. It is required for all database access.');
  }
}

/**
 * Errors Next.js catches itself (server components, uncaught route handler errors,
 * server actions, proxy). Route handlers that use handleError log there instead.
 * Logged as structured JSON so the hosting platform's log search/alerts pick them up.
 */
export const onRequestError: Instrumentation.onRequestError = (error, request, context) => {
  const requestId = request.headers[REQUEST_ID_HEADER];
  logger.error('Unhandled request error', {
    requestId: Array.isArray(requestId) ? requestId[0] : requestId,
    method: request.method,
    path: request.path.split('?')[0],
    routePath: context.routePath,
    routeType: context.routeType,
    digest:
      typeof error === 'object' && error !== null && 'digest' in error ? String(error.digest) : undefined,
    ...describeError(error),
  });
};
