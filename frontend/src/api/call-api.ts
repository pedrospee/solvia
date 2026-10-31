import { errorResponseSchema } from "@solvia/contracts";
import type { ClientResponse, parseResponse } from "hono/client";

/** The API could not be reached: the server is down or the network failed. */
export const NETWORK_ERROR = "NETWORK_ERROR";
/** Something answered, but not with the API's error shape (e.g. the dev proxy, API down). */
export const UNEXPECTED_RESPONSE = "UNEXPECTED_RESPONSE";

/** A failed API call, with the stable code screens decide on, never its raw text (ADR-0003). */
export class ApiRequestError extends Error {
  /** The HTTP status, or 0 when no answer arrived. */
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, unknown> | undefined;

  constructor(
    status: number,
    code: string,
    message: string,
    details?: Record<string, unknown>,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ApiRequestError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** The body of the call's successful answers, as hono/client types it. */
type SuccessBody<R extends ClientResponse<unknown>> = Awaited<ReturnType<typeof parseResponse<R>>>;

/**
 * Awaits a hono/client call and returns its JSON body (undefined for a 204), or throws an
 * ApiRequestError: the API's own code when it answered with its error shape, NETWORK_ERROR or
 * UNEXPECTED_RESPONSE otherwise.
 */
export async function callApi<R extends ClientResponse<unknown>>(
  request: Promise<R>,
): Promise<SuccessBody<R>> {
  let response: R;
  try {
    response = await request;
  } catch (error) {
    throw new ApiRequestError(0, NETWORK_ERROR, "The API could not be reached.", undefined, {
      cause: error,
    });
  }

  if (response.ok) {
    return (response.status === 204 ? undefined : await response.json()) as SuccessBody<R>;
  }

  const body: unknown = await response.json().catch(() => undefined);
  const parsed = errorResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new ApiRequestError(
      response.status,
      UNEXPECTED_RESPONSE,
      `The API answered ${response.status} without its error shape.`,
    );
  }
  const { code, message, details } = parsed.data.error;
  throw new ApiRequestError(response.status, code, message, details);
}
