import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { AppDatabase } from "../infrastructure/database/client.ts";
import { createAccountService } from "../modules/accounts/account-service.ts";
import { createCategoryService } from "../modules/categories/category-service.ts";
import { createExchangeRateRepository } from "../modules/exchange-rates/exchange-rate-repository.ts";
import { createExchangeRateService } from "../modules/exchange-rates/exchange-rate-service.ts";
import { createTransactionService } from "../modules/transactions/transaction-service.ts";
import { ApiError, errorHandler, notFoundHandler } from "./error-handler.ts";
import { localRequestGuard } from "./local-request-guard.ts";
import { accountRoutes } from "./routes/accounts.ts";
import { categoryRoutes } from "./routes/categories.ts";
import { exchangeRateRoutes } from "./routes/exchange-rates.ts";
import { healthRoutes } from "./routes/health.ts";
import { transactionRoutes } from "./routes/transactions.ts";

/** Far above any operation the API accepts (one is under 1 KB), so only abuse reaches it. */
export const MAX_BODY_SIZE = 1024 * 1024;

export type AppDependencies = Readonly<{
  db: AppDatabase;
  /** The Host values the server answers to: see localHosts (docs/security.md). */
  allowedHosts: readonly string[];
}>;

/**
 * Builds the HTTP application. Routes are chained so that `AppType` carries the
 * complete route types for `hono/client` (ADR-0003). Starting the server is
 * the job of main.ts, so tests call `app.request()` directly.
 */
export function createApp({ db, allowedHosts }: AppDependencies) {
  const accountService = createAccountService(db);
  const categoryService = createCategoryService(db);
  const exchangeRateService = createExchangeRateService(createExchangeRateRepository(db));
  const transactionService = createTransactionService(db);

  const app = new Hono()
    .use(localRequestGuard(allowedHosts))
    .use(
      bodyLimit({
        maxSize: MAX_BODY_SIZE,
        onError: () => {
          throw new ApiError(413, "PAYLOAD_TOO_LARGE", "The request body is too large.");
        },
      }),
    )
    .basePath("/api")
    .route("/health", healthRoutes)
    .route("/accounts", accountRoutes(accountService))
    .route("/categories", categoryRoutes(categoryService))
    .route("/exchange-rates", exchangeRateRoutes(exchangeRateService))
    .route("/transactions", transactionRoutes(transactionService));

  app.onError(errorHandler);
  app.notFound(notFoundHandler);

  return app;
}

export type AppType = ReturnType<typeof createApp>;
