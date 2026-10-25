import { listTransactionsQuerySchema, transactionOperationSchema } from "@solvia/contracts";
import { Hono } from "hono";
import type { TransactionService } from "../../modules/transactions/transaction-service.ts";
import { transactionOperationFromJson, transactionToJson } from "../mappers/transaction.ts";
import { validate } from "../validation.ts";

// A transaction is voided, never deleted (BR-24): there is no DELETE route, so such a
// request is ROUTE_NOT_FOUND. Edits are full replacements (PUT), never PATCH (ADR-0003).
export function transactionRoutes(service: TransactionService) {
  return new Hono()
    .get("/", validate("query", listTransactionsQuerySchema), (c) => {
      const items = service.list(c.req.valid("query")).map(transactionToJson);
      return c.json({ items }, 200);
    })
    .post("/", validate("json", transactionOperationSchema), (c) => {
      const record = service.create(transactionOperationFromJson(c.req.valid("json")));
      return c.json(transactionToJson(record), 201);
    })
    .get("/:id", (c) => c.json(transactionToJson(service.get(c.req.param("id"))), 200))
    .put("/:id", validate("json", transactionOperationSchema), (c) => {
      const operation = transactionOperationFromJson(c.req.valid("json"));
      return c.json(transactionToJson(service.edit(c.req.param("id"), operation)), 200);
    })
    .post("/:id/void", (c) => c.json(transactionToJson(service.void(c.req.param("id"))), 200));
}
