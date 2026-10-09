
jest.mock('@/lib/utils/request-id', () => ({
  getRequestId: jest.fn(async () => 'req-123'),
}));

jest.mock('@/lib/utils/logger', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
  describeError: (jest.requireActual('@/lib/utils/logger') as typeof import('@/lib/utils/logger')).describeError,
}));

import { handleError } from '../error-handler';
import { BadRequestError, NotFoundError } from '../custom-errors';
import { logger } from '@/lib/utils/logger';

describe('handleError', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns the request id with a 500 and logs the error with it', async () => {
    const response = await handleError(new Error('db exploded'));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Internal server error', requestId: 'req-123' });
    expect(logger.error).toHaveBeenCalledWith(
      'Unhandled error',
      expect.objectContaining({ requestId: 'req-123', name: 'Error', message: 'db exploded' })
    );
  });

  it('does not leak internal details to the client', async () => {
    const response = await handleError(new Error('relation "secret" does not exist'));

    expect(JSON.stringify(await response.json())).not.toContain('secret');
  });

  it('maps domain errors without logging them as unhandled', async () => {
    const notFound = await handleError(new NotFoundError('Event not found'));
    const badRequest = await handleError(new BadRequestError('Bad input'));

    expect(notFound.status).toBe(404);
    expect(await notFound.json()).toEqual({ error: 'Event not found' });
    expect(badRequest.status).toBe(400);
    expect(logger.error).not.toHaveBeenCalled();
  });
});
