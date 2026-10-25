import { z } from "zod";
import { exchangeRateSourceSchema } from "./exchange-rate.ts";
import { localDateSchema } from "./local-date.ts";
import { currencySchema, moneySchema } from "./money.ts";

// Kept explicit here instead of importing @solvia/core (ADR-0003); a backend test
// fails if these lists drift from the core's.
export const transactionTypeSchema = z.enum([
  "OPENING_BALANCE",
  "INCOME",
  "EXPENSE",
  "TRANSFER",
  "CARD_PAYMENT",
  "CONVERSION",
]);

export type TransactionTypeJson = z.infer<typeof transactionTypeSchema>;

export const systemPostingRoleSchema = z.enum(["OPENING_BALANCE_EQUITY", "EXCHANGE_CLEARING"]);

export type SystemPostingRoleJson = z.infer<typeof systemPostingRoleSchema>;

const details = { date: localDateSchema, description: z.string() };

/**
 * POST /api/transactions and PUT /api/transactions/:id: one human operation, never
 * postings (ADR-0004, section 9). The server builds the postings and, for two
 * currencies, derives the rate, so sending postings or a rate is rejected. Only the
 * representation is checked here: signs, currencies and type rules are @solvia/core's.
 */
export const transactionOperationSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("OPENING_BALANCE"),
    ...details,
    accountId: z.string(),
    /** As the user reads it: money held for assets, money owed for liabilities. */
    balance: moneySchema,
  }),
  z.strictObject({
    type: z.literal("INCOME"),
    ...details,
    accountId: z.string(),
    categoryId: z.string(),
    amount: moneySchema,
  }),
  z.strictObject({
    type: z.literal("EXPENSE"),
    ...details,
    paidFromAccountId: z.string(),
    categoryId: z.string(),
    amount: moneySchema,
    /** Only when `amount` is in another currency: what the account was actually charged. */
    chargedAmount: moneySchema.optional(),
  }),
  z.strictObject({
    type: z.literal("TRANSFER"),
    ...details,
    fromAccountId: z.string(),
    toAccountId: z.string(),
    amount: moneySchema,
  }),
  z.strictObject({
    type: z.literal("CARD_PAYMENT"),
    ...details,
    fromAccountId: z.string(),
    cardAccountId: z.string(),
    amount: moneySchema,
  }),
  z.strictObject({
    type: z.literal("CONVERSION"),
    ...details,
    fromAccountId: z.string(),
    toAccountId: z.string(),
    sentAmount: moneySchema,
    receivedAmount: moneySchema,
    fee: z.strictObject({ categoryId: z.string(), amount: moneySchema }).optional(),
  }),
]);

export type TransactionOperationRequest = z.infer<typeof transactionOperationSchema>;

/** GET /api/transactions. Voided transactions are left out unless asked for (V8). */
export const listTransactionsQuerySchema = z.strictObject({
  includeVoided: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value === "true"),
});

export const postingTargetSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("ACCOUNT"), accountId: z.string() }),
  z.strictObject({ kind: z.literal("CATEGORY"), categoryId: z.string() }),
  z.strictObject({ kind: z.literal("SYSTEM"), role: systemPostingRoleSchema }),
]);

/** For reading only. Sign convention: positive increases assets and expenses. */
export const postingResponseSchema = z.strictObject({
  target: postingTargetSchema,
  amount: moneySchema,
});

export const transactionResponseSchema = z.strictObject({
  id: z.string(),
  type: transactionTypeSchema,
  date: z.string(),
  description: z.string(),
  postings: z.array(postingResponseSchema),
  /** The executed EUR/BRL rate of a two-currency transaction; null otherwise. */
  exchangeRate: z
    .strictObject({
      baseCurrency: currencySchema,
      quoteCurrency: currencySchema,
      rate: z.string(),
      effectiveDate: z.string(),
      source: exchangeRateSourceSchema,
      recordedAt: z.iso.datetime(),
    })
    .nullable(),
  voidedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export type TransactionResponse = z.infer<typeof transactionResponseSchema>;

export const transactionListResponseSchema = z.strictObject({
  items: z.array(transactionResponseSchema),
});

export type TransactionListResponse = z.infer<typeof transactionListResponseSchema>;
