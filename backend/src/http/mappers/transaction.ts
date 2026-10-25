import type { TransactionOperationRequest, TransactionResponse } from "@solvia/contracts";
import { parseLocalDate } from "@solvia/core";
import type { TransactionRecord } from "../../modules/transactions/transaction-repository.ts";
import type { TransactionOperation } from "../../modules/transactions/transaction-service.ts";
import { moneyFromJson, moneyToJson } from "./money.ts";

// Amounts become bigint Money and the date a core LocalDate; ids and the type pass through.

export function transactionOperationFromJson(
  json: TransactionOperationRequest,
): TransactionOperation {
  const details = { date: parseLocalDate(json.date), description: json.description };

  switch (json.type) {
    case "OPENING_BALANCE":
      return { ...json, ...details, balance: moneyFromJson(json.balance) };
    case "INCOME":
    case "TRANSFER":
    case "CARD_PAYMENT":
      return { ...json, ...details, amount: moneyFromJson(json.amount) };
    case "EXPENSE": {
      const { chargedAmount, ...rest } = json;
      return {
        ...rest,
        ...details,
        amount: moneyFromJson(json.amount),
        ...(chargedAmount === undefined ? {} : { chargedAmount: moneyFromJson(chargedAmount) }),
      };
    }
    case "CONVERSION": {
      const { fee, ...rest } = json;
      return {
        ...rest,
        ...details,
        sentAmount: moneyFromJson(json.sentAmount),
        receivedAmount: moneyFromJson(json.receivedAmount),
        ...(fee === undefined
          ? {}
          : { fee: { categoryId: fee.categoryId, amount: moneyFromJson(fee.amount) } }),
      };
    }
  }
}

export function transactionToJson({
  transaction,
  voidedAt,
  createdAt,
  updatedAt,
}: TransactionRecord): TransactionResponse {
  return {
    id: transaction.id,
    type: transaction.type,
    date: transaction.date,
    description: transaction.description,
    postings: transaction.postings.map(({ target, amount }) => ({
      target,
      amount: moneyToJson(amount),
    })),
    exchangeRate: transaction.exchangeRate ?? null,
    voidedAt,
    createdAt,
    updatedAt,
  };
}
