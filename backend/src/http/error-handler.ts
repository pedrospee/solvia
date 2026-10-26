import type { ErrorResponse } from "@solvia/contracts";
import { DomainError } from "@solvia/core";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { ConflictError, NotFoundError } from "../modules/errors.ts";

/**
 * An application failure with a stable code: invalid input (400), a request from
 * outside the local server (403), a missing resource (404), a conflict with the
 * current state (409) or a body over the size limit (413). Financial rule
 * violations are DomainErrors from @solvia/core instead (422).
 */
export class ApiError extends Error {
  readonly status: 400 | 403 | 404 | 409 | 413;
  readonly code: string;
  readonly details: Record<string, unknown> | undefined;

  constructor(
    status: 400 | 403 | 404 | 409 | 413,
    code: string,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** Maps every thrown error to the single API error shape (ADR-0003). */
export function errorHandler(error: Error, c: Context): Response {
  if (error instanceof ApiError) {
    return errorResponse(c, error.status, error.code, error.message, error.details);
  }
  if (error instanceof NotFoundError) {
    return errorResponse(c, 404, error.code, error.message);
  }
  if (error instanceof ConflictError) {
    return errorResponse(c, 409, error.code, error.message);
  }
  if (error instanceof DomainError) {
    return errorResponse(c, 422, error.code, error.message);
  }
  // Raised by Hono itself before our code runs, e.g. a malformed JSON body.
  if (error instanceof HTTPException && error.status === 400) {
    return errorResponse(c, 400, "INVALID_REQUEST", error.message);
  }

  // Anything else is a bug or an infrastructure failure: log it, reveal nothing.
  console.error(error);
  return errorResponse(c, 500, "INTERNAL_ERROR", "An unexpected error occurred.");
}

export function notFoundHandler(c: Context): Response {
  return errorResponse(c, 404, "ROUTE_NOT_FOUND", `No route for ${c.req.method} ${c.req.path}.`);
}

function errorResponse(
  c: Context,
  status: ContentfulStatusCode,
  code: string,
  message: string,
  details?: Record<string, unknown>,
): Response {
  const body: ErrorResponse = { error: { code, message, ...(details ? { details } : {}) } };
  return c.json(body, status);
}
