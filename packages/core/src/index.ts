// Public API of @solvia/core. Other workspaces import only from here, never from deep paths.
// Low-level arithmetic helpers and test fixtures are intentionally not exported.

export { type Decimal, formatDecimal, parseDecimal } from "./decimal.ts";
export { DomainError, type DomainErrorCode } from "./domain-error.ts";
export {
  CANONICAL_EXCHANGE_RATE_PAIR,
  calculateExecutedRate,
  convertMoney,
  createExchangeRate,
  createManualExchangeRate,
  EXCHANGE_RATE_SOURCES,
  type ExchangeRate,
  type ExchangeRateSource,
  invertExchangeRate,
} from "./exchange/exchange-rate.ts";
export { convertMoneyOnDate, findApplicableRate } from "./exchange/exchange-rate-history.ts";
export {
  type Account,
  type AccountKind,
  type AccountNature,
  ASSET_ACCOUNT_KINDS,
  createAccount,
  getAccountNature,
  LIABILITY_ACCOUNT_KINDS,
} from "./ledger/account.ts";
export {
  calculateAccountBalance,
  type IncomeAndExpense,
  summarizeIncomeAndExpense,
} from "./ledger/balances.ts";
export {
  assertValidCategoryHierarchy,
  type Category,
  type CategoryNature,
  createCategory,
} from "./ledger/category.ts";
export { assertOneOpeningBalancePerAccount } from "./ledger/opening-balance.ts";
export { calculateOverdraft, type Overdraft } from "./ledger/overdraft.ts";
export {
  type Posting,
  type PostingTarget,
  type SystemPostingRole,
  TRANSACTION_TYPES,
  type Transaction,
  type TransactionType,
} from "./ledger/transaction.ts";
export {
  createCardPaymentTransaction,
  createConversionTransaction,
  createExpenseTransaction,
  createIncomeTransaction,
  createOpeningBalanceTransaction,
  createTransferTransaction,
} from "./ledger/transaction-factories.ts";
export { assertValidTransaction, type LedgerReferences } from "./ledger/transaction-validation.ts";
export { type LocalDate, parseLocalDate } from "./local-date.ts";
export { CURRENCIES, type Currency, MINOR_UNIT_DIGITS } from "./money/currency.ts";
export {
  addMoney,
  allocateMoney,
  assertSameCurrency,
  createMoney,
  formatMoney,
  isZeroMoney,
  type Money,
  moneyFromDecimal,
  negateMoney,
  subtractMoney,
  sumMoney,
  zeroMoney,
} from "./money/money.ts";
