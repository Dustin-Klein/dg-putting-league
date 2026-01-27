import { NextResponse } from "next/server";
import { ZodError } from "zod";
import {
  UnauthorizedError,
  BadRequestError,
  NotFoundError,
  ForbiddenError,
} from "./custom-errors";

/**
 * Converts domain errors to appropriate HTTP responses.
 * Maps custom error types to their corresponding status codes.
 * Unknown errors are logged and returned as 500 Internal Server Error.
 * @param error - The error to handle
 * @returns NextResponse with appropriate status code and error message
 */
export function handleError(error: unknown) {
  if (error instanceof ZodError) {
    // Log detailed validation errors server-side only
    console.error('Validation error:', error.issues);
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
  if (error instanceof UnauthorizedError) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (error instanceof ForbiddenError) {
    // Log specific error server-side, return generic message to client
    console.error('Forbidden:', error.message);
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (error instanceof BadRequestError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  if (error instanceof NotFoundError) {
    return NextResponse.json({ error: error.message }, { status: 404 });
  }
  console.error(error);
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}
