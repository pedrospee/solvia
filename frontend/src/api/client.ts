import type { AppType } from "@solvia/backend/rpc";
import { hc } from "hono/client";

export type ApiClient = ReturnType<typeof hc<AppType>>;

/**
 * The typed API client (ADR-0003). In the browser `baseUrl` is the page's own origin:
 * the Vite proxy in development, the backend itself for daily use (ADR-0005, D2).
 * Tests pass the in-process API as `fetch`.
 */
export function createApiClient(baseUrl: string, fetch?: typeof globalThis.fetch): ApiClient {
  return hc<AppType>(baseUrl, fetch ? { fetch } : {});
}
