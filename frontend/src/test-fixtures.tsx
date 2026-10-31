// Test helpers: never imported by the app, so never bundled.
import { createTestApp, createTestDatabase } from "@solvia/backend/testing";
import type { CreateAccountRequest, CreateCategoryRequest, MoneyJson } from "@solvia/contracts";
import { QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { ApiProvider } from "./api/api-context.tsx";
import { callApi } from "./api/call-api.ts";
import { type ApiClient, createApiClient } from "./api/client.ts";
import { createQueryClient } from "./api/query-client.ts";
import { App } from "./app.tsx";

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

export type TestApi = ReturnType<typeof createTestApi>;

/** A client whose every call fails as if the API were down. */
export function createUnreachableApi(): ApiClient {
  return createApiClient("http://localhost", () => Promise.reject(new TypeError("fetch failed")));
}

export function renderWithApi(ui: ReactNode, client: ApiClient) {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <ApiProvider client={client}>{ui}</ApiProvider>
    </QueryClientProvider>,
  );
}

/** The whole app, routes included, opened at `path`, with a user to drive it. */
export function renderApp(client: ApiClient, path: string) {
  const user = userEvent.setup();
  const view = renderWithApi(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
    client,
  );
  return { user, ...view };
}

// Fictitious data, created through the API as the UI would.

export function createAccount(client: ApiClient, account: Partial<CreateAccountRequest> = {}) {
  return callApi(
    client.api.accounts.$post({
      json: { name: "Demo Bank", kind: "BANK", currency: "EUR", ...account },
    }),
  );
}

export function createCategory(client: ApiClient, category: Partial<CreateCategoryRequest> = {}) {
  return callApi(
    client.api.categories.$post({
      json: { name: "Demo Category", nature: "EXPENSE", ...category },
    }),
  );
}

export function recordExpense(
  client: ApiClient,
  paidFromAccountId: string,
  categoryId: string,
  amount: MoneyJson,
) {
  return callApi(
    client.api.transactions.$post({
      json: {
        type: "EXPENSE",
        date: "2026-01-02",
        description: "Expense",
        paidFromAccountId,
        categoryId,
        amount,
      },
    }),
  );
}

export function recordOpeningBalance(client: ApiClient, accountId: string, balance: MoneyJson) {
  return callApi(
    client.api.transactions.$post({
      json: {
        type: "OPENING_BALANCE",
        date: "2026-01-01",
        description: "Opening balance",
        accountId,
        balance,
      },
    }),
  );
}

export const eur = (amountMinor: string): MoneyJson => ({ amountMinor, currency: "EUR" });

/**
 * Text as Testing Library reads it from the page, whose default normalizer turns every
 * whitespace into one space: Intl's no-break space after "R$" or "€" included.
 */
export function asShown(text: string): string {
  return text.replace(/\s+/g, " ");
}
