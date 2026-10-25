import {
  type Account,
  type Category,
  calculateAccountBalance,
  calculateOverdraft,
  DomainError,
  type LocalDate,
  moneyFromDecimal,
  parseLocalDate,
  summarizeIncomeAndExpense,
  type Transaction,
} from "@solvia/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createTestDatabase,
  type TestDatabase,
} from "../../infrastructure/database/test-fixtures.ts";
import { createAccountService } from "../accounts/account-service.ts";
import { createCategoryService } from "../categories/category-service.ts";
import { ConflictError, NotFoundError } from "../errors.ts";
import { createTransactionRepository } from "./transaction-repository.ts";
import { createTransactionService, type TransactionOperation } from "./transaction-service.ts";

const eur = (value: string) => moneyFromDecimal(value, "EUR");
const brl = (value: string) => moneyFromDecimal(value, "BRL");
const day = (value: string): LocalDate => parseLocalDate(value);

const T0 = new Date("2026-09-01T10:00:00.000Z");
const T1 = new Date("2026-09-02T10:00:00.000Z");
const T2 = new Date("2026-09-03T10:00:00.000Z");

let database: TestDatabase;
let clock: Date;

/** Fictitious accounts and categories, with readable ids, in every test database. */
function seed(db: TestDatabase["db"]) {
  const ids = [
    "bank",
    "savings",
    "wise-eur",
    "wise-brl",
    "card",
    "salary",
    "food",
    "transport",
    "fees",
  ];
  let next = 0;
  const newId = () => ids[next++] ?? "unexpected";
  const accounts = createAccountService(db, { now: () => T0, newId });
  const categories = createCategoryService(db, { now: () => T0, newId });

  accounts.create({
    name: "Demo Bank",
    kind: "BANK",
    currency: "EUR",
    overdraftLimit: eur("500.00"),
  });
  accounts.create({ name: "Demo Savings", kind: "BANK", currency: "EUR" });
  accounts.create({ name: "Demo Wise EUR", kind: "WISE", currency: "EUR" });
  accounts.create({ name: "Demo Wise BRL", kind: "WISE", currency: "BRL" });
  accounts.create({ name: "Demo Card", kind: "CREDIT_CARD", currency: "EUR" });
  categories.create({ name: "Salary", nature: "INCOME" });
  categories.create({ name: "Food", nature: "EXPENSE" });
  categories.create({ name: "Transport", nature: "EXPENSE" });
  categories.create({ name: "Fees", nature: "EXPENSE" });
  return { accounts, categories };
}

function services(db: TestDatabase["db"] = database.db) {
  let sequence = 0;
  return createTransactionService(db, { now: () => clock, newId: () => `t${++sequence}` });
}

beforeEach(() => {
  database = createTestDatabase();
  seed(database.db);
  clock = T0;
});

afterEach(() => {
  // ADR-0004, fact 6: SQLite cannot enforce "at least two postings", so every
  // scenario, including failures, ends with this check.
  const thin = database.sqlite
    .prepare(
      "SELECT t.id FROM transactions t LEFT JOIN postings p ON p.transaction_id = t.id GROUP BY t.id HAVING count(p.position) < 2",
    )
    .all();
  expect(thin).toEqual([]);
  database.sqlite.close();
});

const details = { date: day("2026-09-15"), description: "Fictitious" };

const operations = {
  opening: {
    ...details,
    type: "OPENING_BALANCE",
    accountId: "bank",
    balance: eur("1000.00"),
  },
  income: {
    ...details,
    type: "INCOME",
    accountId: "bank",
    categoryId: "salary",
    amount: eur("3000.00"),
  },
  expense: {
    ...details,
    type: "EXPENSE",
    paidFromAccountId: "bank",
    categoryId: "food",
    amount: eur("45.90"),
  },
  foreignExpense: {
    ...details,
    type: "EXPENSE",
    paidFromAccountId: "card",
    categoryId: "food",
    amount: brl("120.00"),
    chargedAmount: eur("20.40"),
  },
  transfer: {
    ...details,
    type: "TRANSFER",
    fromAccountId: "bank",
    toAccountId: "wise-eur",
    amount: eur("300.00"),
  },
  cardPayment: {
    ...details,
    type: "CARD_PAYMENT",
    fromAccountId: "bank",
    cardAccountId: "card",
    amount: eur("500.00"),
  },
  conversion: {
    ...details,
    type: "CONVERSION",
    fromAccountId: "wise-eur",
    toAccountId: "wise-brl",
    sentAmount: eur("100.00"),
    receivedAmount: brl("620.00"),
    fee: { categoryId: "fees", amount: eur("1.00") },
  },
} satisfies Record<string, TransactionOperation>;

function counts() {
  const count = (table: string) =>
    database.sqlite.prepare(`SELECT count(*) FROM ${table}`).pluck().get();
  return { transactions: count("transactions"), postings: count("postings") };
}

function expectError(action: () => unknown, type: new (...args: never[]) => Error, code: string) {
  expect(action).toThrowError(expect.objectContaining({ code }));
  expect(action).toThrow(type);
}

describe("create", () => {
  it("persists each of the six types and reads it back as the core built it", () => {
    const transactions = services();

    for (const operation of Object.values(operations)) {
      const created = transactions.create(operation);

      expect(created).toMatchObject({
        voidedAt: null,
        createdAt: T0.toISOString(),
        updatedAt: T0.toISOString(),
      });
      expect(transactions.get(created.transaction.id)).toEqual(created);
    }
    // 2 + 2 + 2 + 4 (foreign charge) + 2 + 2 + 5 (conversion with a fee)
    expect(counts()).toEqual({ transactions: 7n, postings: 19n });
  });

  it("records a two-currency rate at the version timestamp: recordedAt === updatedAt", () => {
    const transactions = services();

    for (const operation of [operations.conversion, operations.foreignExpense]) {
      const { transaction } = transactions.create(operation);
      const stored = transactions.get(transaction.id);

      expect(stored.transaction.exchangeRate).toMatchObject({
        baseCurrency: "EUR",
        quoteCurrency: "BRL",
        source: "TRANSACTION",
        effectiveDate: details.date,
        recordedAt: stored.updatedAt,
      });
    }
    expect(
      transactions.list({ includeVoided: false }).map((r) => r.transaction.exchangeRate?.rate),
    ).toEqual(["6.2", "5.882353"]);
  });

  it("rejects unknown references and core violations, writing nothing", () => {
    const transactions = services();

    expectError(
      () => transactions.create({ ...operations.expense, paidFromAccountId: "missing" }),
      NotFoundError,
      "ACCOUNT_NOT_FOUND",
    );
    expectError(
      () => transactions.create({ ...operations.expense, categoryId: "missing" }),
      NotFoundError,
      "CATEGORY_NOT_FOUND",
    );
    expectError(
      () => transactions.create({ ...operations.expense, categoryId: "salary" }),
      DomainError,
      "INVALID_TRANSACTION",
    );
    expectError(
      () => transactions.create({ ...operations.transfer, toAccountId: "card" }),
      DomainError,
      "INVALID_TRANSACTION",
    );
    expect(counts()).toEqual({ transactions: 0n, postings: 0n });
  });

  it("never adds a reference to an archived account or category", () => {
    const { accounts, categories } = seedServices();
    const transactions = services();
    accounts.archive("bank");
    categories.archive("transport");

    expectError(() => transactions.create(operations.expense), ConflictError, "ACCOUNT_ARCHIVED");
    expectError(
      () =>
        transactions.create({
          ...operations.expense,
          paidFromAccountId: "savings",
          categoryId: "transport",
        }),
      ConflictError,
      "CATEGORY_ARCHIVED",
    );
    expect(counts()).toEqual({ transactions: 0n, postings: 0n });
  });

  it("allows one effective opening balance per account (BR-25, V7)", () => {
    const transactions = services();
    const first = transactions.create(operations.opening);

    expectError(() => transactions.create(operations.opening), DomainError, "INVALID_TRANSACTION");
    transactions.create({ ...operations.opening, accountId: "savings" });

    transactions.void(first.transaction.id);
    expect(() => transactions.create(operations.opening)).not.toThrow();
  });
});

describe("edit", () => {
  it("replaces the operation, keeping id, type and createdAt", () => {
    const transactions = services();
    const created = transactions.create(operations.expense);
    clock = T1;

    const edited = transactions.edit(created.transaction.id, {
      ...operations.expense,
      date: day("2026-09-16"),
      description: "Supermarket",
      amount: eur("50.00"),
    });

    expect(edited).toMatchObject({
      createdAt: T0.toISOString(),
      updatedAt: T1.toISOString(),
      voidedAt: null,
      transaction: { id: created.transaction.id, type: "EXPENSE", description: "Supermarket" },
    });
    expect(edited.transaction.postings.map((p) => p.amount)).toEqual([eur("50.00"), eur("-50.00")]);
    expect(transactions.get(created.transaction.id)).toEqual(edited);
  });

  it("recalculates the rate from the new legs, recorded at the new updatedAt", () => {
    const transactions = services();
    const created = transactions.create(operations.conversion);
    clock = T1;

    const edited = transactions.edit(created.transaction.id, {
      ...operations.conversion,
      receivedAmount: brl("610.00"),
    });

    expect(edited.transaction.exchangeRate).toMatchObject({
      rate: "6.1",
      recordedAt: T1.toISOString(),
    });
    expect(transactions.get(created.transaction.id).transaction.exchangeRate?.recordedAt).toBe(
      edited.updatedAt,
    );
  });

  it("changes nothing, updatedAt and the rate's recordedAt included, for an unchanged operation", () => {
    const transactions = services();
    const created = transactions.create(operations.conversion);
    clock = T1;

    const edited = transactions.edit(created.transaction.id, operations.conversion);

    expect(edited).toEqual(created);
    expect(transactions.get(created.transaction.id)).toEqual(created);
  });

  it("rejects a change of type, an edit of a voided transaction and an unknown id", () => {
    const transactions = services();
    const { transaction } = transactions.create(operations.expense);

    expectError(
      () => transactions.edit(transaction.id, operations.income),
      ConflictError,
      "TRANSACTION_TYPE_IMMUTABLE",
    );
    transactions.void(transaction.id);
    expectError(
      () => transactions.edit(transaction.id, operations.expense),
      ConflictError,
      "TRANSACTION_VOIDED",
    );
    expectError(
      () => transactions.edit("missing", operations.expense),
      NotFoundError,
      "TRANSACTION_NOT_FOUND",
    );
  });

  it("checks opening balance uniqueness over the ledger as it will be after the edit", () => {
    const transactions = services();
    const bankOpening = transactions.create(operations.opening);
    transactions.create({ ...operations.opening, accountId: "savings" });

    // The current version is replaced, not counted twice.
    expect(() =>
      transactions.edit(bankOpening.transaction.id, {
        ...operations.opening,
        balance: eur("900.00"),
      }),
    ).not.toThrow();
    expectError(
      () =>
        transactions.edit(bankOpening.transaction.id, {
          ...operations.opening,
          accountId: "savings",
        }),
      DomainError,
      "INVALID_TRANSACTION",
    );
  });

  describe("archived references (ADR-0004, section 4)", () => {
    it("keeps an existing reference to an archived account or category", () => {
      const { accounts, categories } = seedServices();
      const transactions = services();
      const { transaction } = transactions.create(operations.expense);
      accounts.archive("bank");
      categories.archive("food");

      expect(() =>
        transactions.edit(transaction.id, { ...operations.expense, amount: eur("10.00") }),
      ).not.toThrow();
    });

    it("removes an archived reference where the operation allows it", () => {
      const { categories } = seedServices();
      const transactions = services();
      const { transaction } = transactions.create(operations.conversion);
      categories.archive("fees");
      const { fee: _removed, ...withoutFee } = operations.conversion;

      const edited = transactions.edit(transaction.id, withoutFee);

      expect(edited.transaction.postings.some((p) => p.target.kind === "CATEGORY")).toBe(false);
    });

    it("changes an archived reference to an active one", () => {
      const { accounts, categories } = seedServices();
      const transactions = services();
      const { transaction } = transactions.create(operations.expense);
      accounts.archive("bank");
      categories.archive("food");

      expect(() =>
        transactions.edit(transaction.id, {
          ...operations.expense,
          paidFromAccountId: "savings",
          categoryId: "transport",
        }),
      ).not.toThrow();
    });

    it("never adds a new reference to an archived account or category", () => {
      const { accounts, categories } = seedServices();
      const transactions = services();
      const expense = transactions.create(operations.expense);
      const transfer = transactions.create(operations.transfer);
      accounts.archive("savings");
      categories.archive("transport");
      clock = T1;

      expectError(
        () =>
          transactions.edit(expense.transaction.id, {
            ...operations.expense,
            categoryId: "transport",
          }),
        ConflictError,
        "CATEGORY_ARCHIVED",
      );
      expectError(
        () =>
          transactions.edit(transfer.transaction.id, {
            ...operations.transfer,
            toAccountId: "savings",
          }),
        ConflictError,
        "ACCOUNT_ARCHIVED",
      );
      expect(transactions.get(expense.transaction.id)).toEqual(expense);
      expect(transactions.get(transfer.transaction.id)).toEqual(transfer);
    });
  });
});

describe("void", () => {
  it("keeps the transaction and its postings, readable by id and with includeVoided (V8)", () => {
    const transactions = services();
    const kept = transactions.create(operations.income);
    const voided = transactions.create(operations.expense);
    clock = T1;

    const result = transactions.void(voided.transaction.id);

    expect(result).toEqual({ ...voided, voidedAt: T1.toISOString() });
    expect(transactions.get(voided.transaction.id)).toEqual(result);
    expect(transactions.list({ includeVoided: false })).toEqual([kept]);
    expect(transactions.list({ includeVoided: true })).toEqual([kept, result]);
    expect(counts()).toEqual({ transactions: 2n, postings: 4n });
  });

  it("does not change updatedAt or the rate's recordedAt (V9)", () => {
    const transactions = services();
    const created = transactions.create(operations.conversion);
    clock = T1;

    const voided = transactions.void(created.transaction.id);

    expect(voided.updatedAt).toBe(created.updatedAt);
    expect(transactions.get(created.transaction.id).transaction.exchangeRate?.recordedAt).toBe(
      created.updatedAt,
    );
  });

  it("is idempotent, keeping the first voidedAt (V5)", () => {
    const transactions = services();
    const { transaction } = transactions.create(operations.expense);
    clock = T1;
    const first = transactions.void(transaction.id);
    clock = T2;

    expect(transactions.void(transaction.id)).toEqual(first);
    expect(transactions.get(transaction.id).voidedAt).toBe(T1.toISOString());
  });

  it("is allowed with archived references (V6)", () => {
    const { accounts, categories } = seedServices();
    const transactions = services();
    const { transaction } = transactions.create(operations.expense);
    accounts.archive("bank");
    categories.archive("food");

    expect(transactions.void(transaction.id).voidedAt).not.toBeNull();
  });

  it("changes every derived value exactly as if the transaction had never been recorded", () => {
    const base = [
      operations.opening,
      operations.income,
      operations.cardPayment,
      operations.conversion,
    ];
    const mistakes = Object.values(operations).filter(
      (operation) => operation !== operations.opening,
    );

    const withVoided = createTestDatabase();
    const without = createTestDatabase();
    try {
      seed(withVoided.db);
      seed(without.db);
      const voiding = services(withVoided.db);
      const recording = createTransactionService(without.db, { now: () => clock });
      for (const operation of base) {
        voiding.create(operation);
        recording.create(operation);
      }
      for (const mistake of mistakes) {
        voiding.void(voiding.create(mistake).transaction.id);
      }

      expect(derivedValues(withVoided)).toEqual(derivedValues(without));
      expect(voiding.list({ includeVoided: true })).toHaveLength(base.length + mistakes.length);
    } finally {
      withVoided.sqlite.close();
      without.sqlite.close();
    }
  });
});

describe("atomicity (ADR-0004, section 1)", () => {
  /** Fails the insert of a transaction's second posting, after its row and first posting. */
  function failOnSecondPosting() {
    database.sqlite.exec(
      "CREATE TEMP TRIGGER fail_second_posting BEFORE INSERT ON postings WHEN NEW.position = 1 BEGIN SELECT RAISE(ABORT, 'injected failure'); END",
    );
  }

  it("leaves both tables untouched when a create fails halfway", () => {
    const transactions = services();
    failOnSecondPosting();

    expect(() => transactions.create(operations.expense)).toThrow(/injected failure/);

    expect(counts()).toEqual({ transactions: 0n, postings: 0n });
  });

  it("keeps the previous version intact when an edit fails halfway", () => {
    const transactions = services();
    const created = transactions.create(operations.expense);
    clock = T1;
    failOnSecondPosting();

    expect(() =>
      transactions.edit(created.transaction.id, { ...operations.expense, amount: eur("99.00") }),
    ).toThrow(/injected failure/);

    expect(transactions.get(created.transaction.id)).toEqual(created);
    expect(counts()).toEqual({ transactions: 1n, postings: 2n });
  });
});

function seedServices() {
  return {
    accounts: createAccountService(database.db, { now: () => clock }),
    categories: createCategoryService(database.db, { now: () => clock }),
  };
}

/** Every value the core derives from the ledger: balances, overdraft, income and expense. */
function derivedValues({ db }: TestDatabase) {
  const ledger: readonly Transaction[] = createTransactionRepository(db).loadEffectiveLedger();
  const accounts: Account[] = createAccountService(db)
    .list({ includeArchived: true })
    .map((record) => record.account);
  const categories: Category[] = createCategoryService(db)
    .list({ includeArchived: true })
    .map((record) => record.category);

  return {
    balances: accounts.map((account) => [account.id, calculateAccountBalance(account, ledger)]),
    overdrafts: accounts.map((account) => [account.id, calculateOverdraft(account, ledger)]),
    eur: summarizeIncomeAndExpense(ledger, categories, "EUR"),
    brl: summarizeIncomeAndExpense(ledger, categories, "BRL"),
  };
}
