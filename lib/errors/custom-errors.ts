/**
 * Error thrown when authentication is required but not provided.
 * Maps to HTTP 401 Unauthorized.
 */
export class UnauthorizedError extends Error {
  constructor(message = 'Unauthorized') {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

/**
 * Error thrown when the user lacks permission for the requested action.
 * Maps to HTTP 403 Forbidden.
 */
export class ForbiddenError extends Error {
  constructor(message = 'Forbidden') {
    super(message);
    this.name = 'ForbiddenError';
  }
}

/**
 * Error thrown when a requested resource does not exist.
 * Maps to HTTP 404 Not Found.
 */
export class NotFoundError extends Error {
  constructor(message = 'Not found') {
    super(message);
    this.name = 'NotFoundError';
  }
}

/**
 * Error thrown for unexpected server-side failures.
 * Maps to HTTP 500 Internal Server Error.
 */
export class InternalError extends Error {
  constructor(message = 'Internal error') {
    super(message);
    this.name = 'InternalError';
  }
}

/**
 * Error thrown when request data is invalid or violates business rules.
 * Maps to HTTP 400 Bad Request.
 */
export class BadRequestError extends Error {
  constructor(message = 'Bad Request error') {
    super(message);
    this.name = 'BadRequestError';
  }
}
