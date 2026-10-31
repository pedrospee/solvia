import { type AccountKindJson, liabilityAccountKinds } from "@solvia/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useApi } from "../api/api-context.tsx";
import { callApi } from "../api/call-api.ts";
import type { ApiClient } from "../api/client.ts";

export const accountKeys = {
  all: ["accounts"] as const,
  list: (includeArchived: boolean) => ["accounts", "list", { includeArchived }] as const,
  detail: (id: string) => ["accounts", "detail", id] as const,
  balance: (id: string) => ["accounts", "balance", id] as const,
};

const liabilityKinds: readonly AccountKindJson[] = liabilityAccountKinds;

/** A liability's balance is money owed; any other account's, money held. */
export function isLiability(kind: AccountKindJson): boolean {
  return liabilityKinds.includes(kind);
}

export function useAccounts(includeArchived: boolean) {
  const api = useApi();
  return useQuery({
    queryKey: accountKeys.list(includeArchived),
    queryFn: () =>
      callApi(api.api.accounts.$get({ query: includeArchived ? { includeArchived: "true" } : {} })),
  });
}

export function useAccount(id: string) {
  const api = useApi();
  return useQuery({
    queryKey: accountKeys.detail(id),
    queryFn: () => callApi(api.api.accounts[":id"].$get({ param: { id } })),
  });
}

export function useAccountBalance(id: string) {
  const api = useApi();
  return useQuery({
    queryKey: accountKeys.balance(id),
    queryFn: () => callApi(api.api.accounts[":id"].balance.$get({ param: { id } })),
  });
}

/**
 * A change to accounts. Afterwards every account query is refetched: lists, details and
 * balances, so no screen shows what the change made stale (ADR-0005, D4).
 */
export function useAccountMutation<Input, Output>(
  call: (api: ApiClient, input: Input) => Promise<Output>,
) {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Input) => call(api, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: accountKeys.all }),
  });
}
