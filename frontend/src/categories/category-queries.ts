import { useQuery } from "@tanstack/react-query";
import { useApi } from "../api/api-context.tsx";
import { callApi } from "../api/call-api.ts";

export const categoryKeys = {
  all: ["categories"] as const,
  list: (includeArchived: boolean) => ["categories", "list", { includeArchived }] as const,
  detail: (id: string) => ["categories", "detail", id] as const,
};

export function useCategories(includeArchived: boolean) {
  const api = useApi();
  return useQuery({
    queryKey: categoryKeys.list(includeArchived),
    queryFn: () =>
      callApi(
        api.api.categories.$get({ query: includeArchived ? { includeArchived: "true" } : {} }),
      ),
  });
}

export function useCategory(id: string) {
  const api = useApi();
  return useQuery({
    queryKey: categoryKeys.detail(id),
    queryFn: () => callApi(api.api.categories[":id"].$get({ param: { id } })),
  });
}
