// Test helpers: never imported by the app, so never bundled.
import { createTestApp, createTestDatabase } from "@solvia/backend/testing";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { ApiProvider } from "./api/api-context.tsx";
import { type ApiClient, createApiClient } from "./api/client.ts";

/**
 * The real API in process, over an in-memory database (ADR-0005, D10): screens are tested
 * against the real routes, contracts and rules, with no mock server to drift from them.
 */
export function createTestApi() {
  const database = createTestDatabase();
  const app = createTestApp(database.db);
  const client = createApiClient("http://localhost", async (input, init) =>
    app.request(input, init),
  );
  return { client, database, close: () => database.sqlite.close() };
}

/** A client whose every call fails as if the API were down. */
export function createUnreachableApi(): ApiClient {
  return createApiClient("http://localhost", () => Promise.reject(new TypeError("fetch failed")));
}

export function renderWithApi(ui: ReactNode, client: ApiClient) {
  // No retries: a failing query fails at once instead of waiting for the test to time out.
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ApiProvider client={client}>{ui}</ApiProvider>
    </QueryClientProvider>,
  );
}
