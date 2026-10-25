import { Hono } from "hono";
import type { AppDatabase } from "../infrastructure/database/client.ts";
import { createAccountService } from "../modules/accounts/account-service.ts";
import { createCategoryService } from "../modules/categories/category-service.ts";
import { createExchangeRateRepository } from "../modules/exchange-rates/exchange-rate-repository.ts";
import { createExchangeRateService } from "../modules/exchange-rates/exchange-rate-service.ts";
import { errorHandler, notFoundHandler } from "./error-handler.ts";
import { accountRoutes } from "./routes/accounts.ts";
import { categoryRoutes } from "./routes/categories.ts";
import { exchangeRateRoutes } from "./routes/exchange-rates.ts";
import { healthRoutes } from "./routes/health.ts";

export type AppDependencies = Readonly<{ db: AppDatabase }>;

/**
 * Builds the HTTP application. Routes are chained so that `AppType` carries the
 * complete route types for `hono/client` (ADR-0003). Starting the server is
 * the job of main.ts, so tests call `app.request()` directly.
 */
export function createApp({ db }: AppDependencies) {
  const accountService = createAccountService(db);
  const categoryService = createCategoryService(db);
  const exchangeRateService = createExchangeRateService(createExchangeRateRepository(db));

  const app = new Hono()
    .basePath("/api")
    .route("/health", healthRoutes)
    .route("/accounts", accountRoutes(accountService))
    .route("/categories", categoryRoutes(categoryService))
    .route("/exchange-rates", exchangeRateRoutes(exchangeRateService));

  app.onError(errorHandler);
  app.notFound(notFoundHandler);

  return app;
}

export type AppType = ReturnType<typeof createApp>;
