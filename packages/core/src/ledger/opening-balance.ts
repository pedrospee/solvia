import { DomainError } from "../domain-error.ts";
import type { Transaction } from "./transaction.ts";

/**
 * BR-25: at most one opening balance per account among the transactions given.
 * The caller passes the effective ledger as it will be after a write: voided
 * transactions left out, and an edited transaction already replaced by its new
 * version. The core knows nothing about voids or persistence.
 */
export function assertOneOpeningBalancePerAccount(transactions: readonly Transaction[]): void {
  const openingByAccount = new Map<string, string>();

  for (const transaction of transactions) {
    if (transaction.type !== "OPENING_BALANCE") {
      continue;
    }
    for (const { target } of transaction.postings) {
      if (target.kind !== "ACCOUNT") {
        continue;
      }
      const existing = openingByAccount.get(target.accountId);
      if (existing !== undefined) {
        throw new DomainError(
          "INVALID_TRANSACTION",
          `Account "${target.accountId}" already has an opening balance (transaction ${existing}); transaction ${transaction.id} would be a second one.`,
        );
      }
      openingByAccount.set(target.accountId, transaction.id);
    }
  }
}
