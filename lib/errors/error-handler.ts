import { NextResponse } from "next/server";
import { ZodError } from "zod";
import {
  UnauthorizedError,
  BadRequestError,
  NotFoundError,
  ForbiddenError,
} from "./custom-errors";
import { logger } from "../utils/logger";

/**
 * Converts domain errors to appropriate HTTP responses.
 * Maps custom error types to their corresponding status codes.
 * Unknown errors are logged and returned as 500 Internal Server Error.
 * @param error - The error to handle
 * @returns NextResponse with appropriate status code and error message
 */
export function handleError(error: unknown) {
  if (error instanceof ZodError) {
    const sanitizedIssues = error.issues.map((issue) => ({
      path: issue.path,
      code: issue.code,
      message: issue.message,
    }));
    logger.error('Validation error', { issues: sanitizedIssues });
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
  if (error instanceof NotFoundError) {
    return NextResponse.json({ error: error.message }, { status: 404 });
  }
  const errorMessage = error instanceof Error ? error.message : 'Unknown error';
  const errorName = error instanceof Error ? error.name : undefined;
  logger.error('Unhandled error', { name: errorName, message: errorMessage });
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}
