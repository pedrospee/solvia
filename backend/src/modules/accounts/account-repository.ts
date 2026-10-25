import { type Account, createMoney } from "@solvia/core";
import { asc, eq, isNull } from "drizzle-orm";
import type { DbExecutor } from "../../infrastructure/database/client.ts";
import { accounts } from "../../infrastructure/database/schema/accounts.ts";

/** An account as persisted: the core Account plus its lifecycle timestamps. */
export type AccountRecord = Readonly<{
  account: Account;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}>;

type AccountRow = typeof accounts.$inferSelect;

export type AccountRepository = ReturnType<typeof createAccountRepository>;

export function createAccountRepository(db: DbExecutor) {
  return {
    insert(record: AccountRecord): void {
      db.insert(accounts).values(toRow(record)).run();
    },

    findById(id: string): AccountRecord | undefined {
      const row = db.select().from(accounts).where(eq(accounts.id, id)).get();
      return row === undefined ? undefined : fromRow(row);
    },

    list(options: { includeArchived: boolean }): AccountRecord[] {
      return db
        .select()
        .from(accounts)
        .where(options.includeArchived ? undefined : isNull(accounts.archivedAt))
        .orderBy(asc(accounts.createdAt), asc(accounts.id))
        .all()
        .map(fromRow);
    },

    /** Writes the mutable fields only: kind, currency and createdAt never change. */
    update(record: AccountRecord): void {
      const { name, institution, overdraftLimitMinor, archivedAt, updatedAt } = toRow(record);
      db.update(accounts)
        .set({ name, institution, overdraftLimitMinor, archivedAt, updatedAt })
        .where(eq(accounts.id, record.account.id))
        .run();
    },

    delete(id: string): void {
      db.delete(accounts).where(eq(accounts.id, id)).run();
    },
  };
}

function toRow({ account, archivedAt, createdAt, updatedAt }: AccountRecord): AccountRow {
  return {
    id: account.id,
    name: account.name,
    institution: account.institution ?? null,
    kind: account.kind,
    currency: account.currency,
    overdraftLimitMinor: account.overdraftLimit?.amountMinor ?? null,
    archivedAt,
    createdAt,
    updatedAt,
  };
}

function fromRow(row: AccountRow): AccountRecord {
  const account: Account = {
    id: row.id,
    name: row.name,
    kind: row.kind,
    currency: row.currency,
    ...(row.institution === null ? {} : { institution: row.institution }),
    ...(row.overdraftLimitMinor === null
      ? {}
      : { overdraftLimit: createMoney(row.overdraftLimitMinor, row.currency) }),
  };
  return {
    account,
    archivedAt: row.archivedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
