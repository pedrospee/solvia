import { z } from "zod";
import { currencySchema, moneySchema } from "./money.ts";

// Kept explicit here instead of importing @solvia/core (ADR-0003); a backend test
// fails if this list drifts from the core's account kinds.
export const accountKindSchema = z.enum([
  "BANK",
  "WISE",
  "CASH",
  "INVESTMENT",
  "CREDIT_CARD",
  "LOAN",
  "FINANCING",
  "INFORMAL_DEBT",
  "PERSONAL_DEBT",
  "OTHER_LIABILITY",
]);

export type AccountKindJson = z.infer<typeof accountKindSchema>;

// Only the representation is checked here. Whether a name may be empty or which
// accounts may have an overdraft limit are rules of @solvia/core (BR-22).

/** POST /api/accounts */
export const createAccountRequestSchema = z.strictObject({
  name: z.string(),
  institution: z.string().optional(),
  kind: accountKindSchema,
  currency: currencySchema,
  overdraftLimit: moneySchema.optional(),
});

export type CreateAccountRequest = z.infer<typeof createAccountRequestSchema>;

/**
 * PATCH /api/accounts/:id. A field left out stays unchanged; `null` removes it.
 * `kind` and `currency` are immutable: sending them is rejected, not ignored.
 */
export const updateAccountRequestSchema = z.strictObject({
  name: z.string().optional(),
  institution: z.string().nullable().optional(),
  overdraftLimit: moneySchema.nullable().optional(),
});

export type UpdateAccountRequest = z.infer<typeof updateAccountRequestSchema>;

/** GET /api/accounts. Archived accounts are left out unless asked for. */
export const listAccountsQuerySchema = z.strictObject({
  includeArchived: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value === "true"),
});

export const accountResponseSchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  institution: z.string().nullable(),
  kind: accountKindSchema,
  currency: currencySchema,
  overdraftLimit: moneySchema.nullable(),
  archivedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export type AccountResponse = z.infer<typeof accountResponseSchema>;

export const accountListResponseSchema = z.strictObject({
  items: z.array(accountResponseSchema),
});

export type AccountListResponse = z.infer<typeof accountListResponseSchema>;

/**
 * GET /api/accounts/:id/balance: derived from the effective ledger, never stored
 * (BR-20, BR-24). `overdraft` is null for an account without an overdraft limit (BR-22).
 */
export const accountBalanceResponseSchema = z.strictObject({
  accountId: z.string(),
  /** As the user reads it: money held for assets (negative = overdraft), owed for liabilities. */
  balance: moneySchema,
  overdraft: z
    .strictObject({
      limit: moneySchema,
      used: moneySchema,
      remaining: moneySchema,
      exceeded: moneySchema,
      availableIncludingOverdraft: moneySchema,
    })
    .nullable(),
});

export type AccountBalanceResponse = z.infer<typeof accountBalanceResponseSchema>;
