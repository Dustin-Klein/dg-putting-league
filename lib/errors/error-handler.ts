import { NextResponse } from "next/server";
import { ZodError } from "zod";
import {
  UnauthorizedError,
  BadRequestError,
  NotFoundError,
  ForbiddenError,
  ConflictError,
} from "./custom-errors";
import { describeError, logger } from "../utils/logger";
import { getRequestId } from "../utils/request-id";

/**
 * Converts domain errors to appropriate HTTP responses.
 * Maps custom error types to their corresponding status codes.
 * Unknown errors are logged with the request id and returned as 500 Internal Server
 * Error; the response includes the request id so users can report it.
 * @param error - The error to handle
 * @returns NextResponse with appropriate status code and error message
 */
export async function handleError(error: unknown): Promise<NextResponse> {
  const requestId = await getRequestId();
  if (error instanceof ZodError) {
    const sanitizedIssues = error.issues.map((issue) => ({
      path: issue.path,
      code: issue.code,
      message: issue.message,
    }));
    logger.error('Validation error', { requestId, issues: sanitizedIssues });
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
  if (error instanceof UnauthorizedError) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (error instanceof ForbiddenError) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (error instanceof BadRequestError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  if (error instanceof ConflictError) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }
  if (error instanceof NotFoundError) {
    return NextResponse.json({ error: error.message }, { status: 404 });
  }
  logger.error('Unhandled error', { requestId, ...describeError(error) });
  return NextResponse.json({ error: 'Internal server error', requestId }, { status: 500 });
}
