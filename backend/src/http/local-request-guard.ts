import type { MiddlewareHandler } from "hono";
import { ApiError } from "./error-handler.ts";

/** Methods that only read: a browser cannot read a cross-origin answer without CORS headers. */
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** The Host values of the server bound to the loopback address: by IP and by name. */
export function localHosts(port: number): string[] {
  return [`127.0.0.1:${port}`, `localhost:${port}`];
}

/** The Vite dev server's port (frontend/vite.config.ts), which serves the UI in development. */
export const DEV_UI_PORT = 5173;

/**
 * The origins allowed besides the server's own. Only in development: the UI is then
 * served by Vite, whose proxy forwards the browser's Origin unchanged (ADR-0005, D2).
 * Rewriting it in the proxy instead would let any site through the dev server.
 */
export function devUiOrigins(nodeEnv: string): string[] {
  return nodeEnv === "development" ? localHosts(DEV_UI_PORT).map((host) => `http://${host}`) : [];
}

/**
 * Keeps a browser on this machine from being used against the API, which has no
 * authentication and relies on being local (docs/security.md):
 * - DNS rebinding: a malicious site can make its own domain resolve to 127.0.0.1, so
 *   the browser treats the API as that site. Its requests still carry the site's
 *   Host, so any Host other than the server's own is a 403 HOST_NOT_ALLOWED, for
 *   every method and route.
 * - CSRF: some requests, such as a POST without a body, reach the API with no CORS
 *   preflight. A change (any method but GET, HEAD and OPTIONS) whose Origin is not
 *   the server's own, or one of `extraOrigins` (devUiOrigins), is a 403
 *   ORIGIN_NOT_ALLOWED. Clients that send no Origin (curl, scripts) are not browsers
 *   acting for a site, and are accepted.
 */
export function localRequestGuard(
  allowedHosts: readonly string[],
  extraOrigins: readonly string[] = [],
): MiddlewareHandler {
  const hosts = new Set(allowedHosts.map((host) => host.toLowerCase()));
  const origins = new Set([
    ...[...hosts].map((host) => `http://${host}`),
    ...extraOrigins.map((origin) => origin.toLowerCase()),
  ]);

  return async (c, next) => {
    // A request reaching the server always has a Host; app.request() in tests may not.
    const host = (c.req.header("Host") ?? new URL(c.req.url).host).toLowerCase();
    if (!hosts.has(host)) {
      throw new ApiError(
        403,
        "HOST_NOT_ALLOWED",
        "Requests must be addressed to the local server.",
      );
    }

    const origin = c.req.header("Origin");
    if (
      origin !== undefined &&
      !SAFE_METHODS.has(c.req.method) &&
      !origins.has(origin.toLowerCase())
    ) {
      throw new ApiError(
        403,
        "ORIGIN_NOT_ALLOWED",
        "Changes are accepted only from the local server's origin.",
      );
    }

    await next();
  };
}
