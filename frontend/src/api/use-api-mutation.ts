import { type QueryKey, useMutation, useQueryClient } from "@tanstack/react-query";
import { useApi } from "./api-context.tsx";
import type { ApiClient } from "./client.ts";

/**
 * A change through the API. Afterwards every query under `invalidates` is refetched, so no
 * screen shows what the change made stale (ADR-0005, D4).
 */
export function useApiMutation<Input, Output>(
  invalidates: QueryKey,
  call: (api: ApiClient, input: Input) => Promise<Output>,
) {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Input) => call(api, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: invalidates }),
  });
}
