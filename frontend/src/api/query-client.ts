import { QueryClient } from "@tanstack/react-query";

/**
 * One configuration for the app and its tests. No retries: the API is on this machine, so a
 * failure is not a flaky network, and a retry would only delay the error the user must see.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}
