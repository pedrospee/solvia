import type { MiddlewareHandler, ValidationTargets } from "hono";
import { validator } from "hono/validator";
import type { z } from "zod";
import { ApiError } from "./error-handler.ts";

/** What `AppType` carries for a validated request part. */
type Validated<Target extends keyof ValidationTargets, Schema extends z.ZodType> = {
  // What hono/client must send: the schema's input.
  in: { [K in Target]: z.input<Schema> };
  // What c.req.valid() returns to the route: the schema's output, after any transform.
  out: { [K in Target]: z.output<Schema> };
};

// The media types Hono's validator reads as JSON: application/json, application/*+json, with parameters.
const JSON_CONTENT_TYPE = /^application\/([a-z-.]+\+)?json(;\s*[a-zA-Z0-9-]+=([^;]+))*$/i;

/**
 * Validates one part of the request (json, query, param…) against a
 * @solvia/contracts schema, using Hono's built-in validator (ADR-0003).
 * A mismatch is a 400 `VALIDATION_FAILED` with the Zod issues in `details`.
 * A json body without a JSON Content-Type is a 400 `INVALID_REQUEST`: Hono would
 * read it as {}, which an all-optional PATCH schema accepts as "change nothing".
 */
export function validate<Target extends keyof ValidationTargets, Schema extends z.ZodType>(
  target: Target,
  schema: Schema,
) {
  const middleware = validator(target, (value, c) => {
    if (target === "json" && !JSON_CONTENT_TYPE.test(c.req.header("Content-Type") ?? "")) {
      throw new ApiError(400, "INVALID_REQUEST", "The request body must be JSON.");
    }
    const result = schema.safeParse(value);
    if (!result.success) {
      throw new ApiError(400, "VALIDATION_FAILED", "The request does not match the API contract.", {
        issues: result.error.issues,
      });
    }
    return result.data;
  });
  // Hono's validator infers its types from conditional types that TypeScript cannot resolve
  // for a generic Schema, so the (runtime-accurate) types are asserted here, in one place.
  // biome-ignore lint/suspicious/noExplicitAny: the same Env as Hono's validator, so it fits any app.
  return middleware as MiddlewareHandler<any, string, Validated<Target, Schema>>;
}
