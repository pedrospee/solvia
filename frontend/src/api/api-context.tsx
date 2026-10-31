import { createContext, type ReactNode, useContext } from "react";
import type { ApiClient } from "./client.ts";

const ApiContext = createContext<ApiClient | undefined>(undefined);

/** Gives every screen the same API client: the browser's in main.tsx, the in-process one in tests. */
export function ApiProvider({ client, children }: { client: ApiClient; children: ReactNode }) {
  return <ApiContext value={client}>{children}</ApiContext>;
}

export function useApi(): ApiClient {
  const client = useContext(ApiContext);
  if (client === undefined) {
    throw new Error("useApi must be called inside an ApiProvider.");
  }
  return client;
}
