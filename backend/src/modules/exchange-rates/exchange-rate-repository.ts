import type { ExchangeRate } from "@solvia/core";
import { asc, eq, max } from "drizzle-orm";
import type { DbExecutor } from "../../infrastructure/database/client.ts";
import { exchangeRates } from "../../infrastructure/database/schema/exchange-rates.ts";

/** A rate as persisted: the core ExchangeRate plus its id. */
export type ExchangeRateRecord = Readonly<{ id: string; exchangeRate: ExchangeRate }>;

type ExchangeRateRow = typeof exchangeRates.$inferSelect;

export type ExchangeRateRepository = ReturnType<typeof createExchangeRateRepository>;

/** Append-only (BR-81): there is deliberately no update and no delete. */
export function createExchangeRateRepository(db: DbExecutor) {
  return {
    insert(record: ExchangeRateRecord): void {
      db.insert(exchangeRates).values(toRow(record)).run();
    },

    findById(id: string): ExchangeRateRecord | undefined {
      const row = db.select().from(exchangeRates).where(eq(exchangeRates.id, id)).get();
      return row === undefined ? undefined : fromRow(row);
    },

    /** The whole history, oldest first. */
    list(): ExchangeRateRecord[] {
      return db
        .select()
        .from(exchangeRates)
        .orderBy(
          asc(exchangeRates.effectiveDate),
          asc(exchangeRates.recordedAt),
          asc(exchangeRates.id),
        )
        .all()
        .map(fromRow);
    },

    /** The most recent recordedAt of any rate, if there is one. */
    latestRecordedAt(): string | undefined {
      const row = db
        .select({ latest: max(exchangeRates.recordedAt) })
        .from(exchangeRates)
        .get();
      return row?.latest ?? undefined;
    },
  };
}

function toRow({ id, exchangeRate }: ExchangeRateRecord): ExchangeRateRow {
  return { id, ...exchangeRate };
}

function fromRow({ id, ...exchangeRate }: ExchangeRateRow): ExchangeRateRecord {
  return { id, exchangeRate };
}
