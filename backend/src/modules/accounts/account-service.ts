import { randomUUID } from "node:crypto";
import {
  type Account,
  calculateAccountBalance,
  calculateOverdraft,
  createAccount,
  type Money,
  type Overdraft,
} from "@solvia/core";
import type { AppDatabase } from "../../infrastructure/database/client.ts";
import { ConflictError, NotFoundError } from "../errors.ts";
import { createTransactionRepository } from "../transactions/transaction-repository.ts";
import { type AccountRecord, createAccountRepository } from "./account-repository.ts";

export type NewAccount = Omit<Account, "id">;

/** A field left out stays unchanged; `null` removes an optional field. */
export type AccountChanges = Readonly<{
  name?: string;
  institution?: string | null;
  overdraftLimit?: Money | null;
}>;

/** Derived from the effective ledger, never stored (BR-20, BR-22, BR-24). */
export type AccountBalance = Readonly<{
  accountId: string;
  balance: Money;
  overdraft: Overdraft | null;
}>;

export type AccountService = ReturnType<typeof createAccountService>;

/**
 * Account use cases. Every account that is written goes through the core's
 * createAccount, which owns the financial rules (BR-22). Archiving is a
 * lifecycle change only: it never touches the ledger.
 */
export function createAccountService(
  db: AppDatabase,
  options: { now?: () => Date; newId?: () => string } = {},
) {
  const repository = createAccountRepository(db);
  const now = () => (options.now ?? (() => new Date()))().toISOString();
  const newId = options.newId ?? randomUUID;

  function load(id: string): AccountRecord {
    const record = repository.findById(id);
    if (record === undefined) {
      throw new NotFoundError("ACCOUNT_NOT_FOUND", `No account with id "${id}".`);
    }
    return record;
  }

  function save(current: AccountRecord, changes: Partial<AccountRecord>): AccountRecord {
    const record = { ...current, ...changes, updatedAt: now() };
    repository.update(record);
    return record;
  }

  return {
    list(options: { includeArchived: boolean }): AccountRecord[] {
      return repository.list(options);
    },

    get: load,

    /** Archived accounts too: their balance still counts in net worth. */
    balance(id: string): AccountBalance {
      const { account } = load(id);
      const ledger = createTransactionRepository(db).loadEffectiveLedger();
      return {
        accountId: account.id,
        balance: calculateAccountBalance(account, ledger),
        overdraft: calculateOverdraft(account, ledger),
      };
    },

    create(input: NewAccount): AccountRecord {
      const account = createAccount({ ...input, id: newId() });
      const timestamp = now();
      const record = { account, archivedAt: null, createdAt: timestamp, updatedAt: timestamp };
      repository.insert(record);
      return record;
    },

    /** An update that changes nothing is a no-op: updatedAt marks the last effective change. */
    update(id: string, changes: AccountChanges): AccountRecord {
      const current = load(id);
      const account = createAccount(applyChanges(current.account, changes));
      return sameEditableFields(account, current.account) ? current : save(current, { account });
    },

    /** Archiving an archived account changes nothing. */
    archive(id: string): AccountRecord {
      const current = load(id);
      return current.archivedAt === null ? save(current, { archivedAt: now() }) : current;
    },

    unarchive(id: string): AccountRecord {
      const current = load(id);
      return current.archivedAt === null ? current : save(current, { archivedAt: null });
    },

    /**
     * Deletes an account no posting references, voided transactions included: their
     * postings are kept (ACCOUNT_IN_USE, ADR-0004 L9). Checked and deleted in one
     * database transaction. An account in use can be archived instead.
     */
    delete(id: string): void {
      db.transaction(
        (tx) => {
          const accounts = createAccountRepository(tx);
          if (accounts.findById(id) === undefined) {
            throw new NotFoundError("ACCOUNT_NOT_FOUND", `No account with id "${id}".`);
          }
          if (createTransactionRepository(tx).isAccountReferenced(id)) {
            throw new ConflictError(
              "ACCOUNT_IN_USE",
              "The account has transactions, so it cannot be deleted; archive it instead.",
            );
          }
          accounts.delete(id);
        },
        { behavior: "immediate" },
      );
    },
  };
}

function sameEditableFields(left: Account, right: Account): boolean {
  return (
    left.name === right.name &&
    left.institution === right.institution &&
    left.overdraftLimit?.amountMinor === right.overdraftLimit?.amountMinor &&
    left.overdraftLimit?.currency === right.overdraftLimit?.currency
  );
}

function applyChanges(account: Account, changes: AccountChanges): Account {
  const { institution, overdraftLimit, ...fixed } = account;
  const nextInstitution =
    changes.institution === undefined ? institution : (changes.institution ?? undefined);
  const nextLimit =
    changes.overdraftLimit === undefined ? overdraftLimit : (changes.overdraftLimit ?? undefined);

  return {
    ...fixed,
    ...(changes.name === undefined ? {} : { name: changes.name }),
    ...(nextInstitution === undefined ? {} : { institution: nextInstitution }),
    ...(nextLimit === undefined ? {} : { overdraftLimit: nextLimit }),
  };
}
