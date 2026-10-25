import {
  createAccountRequestSchema,
  listAccountsQuerySchema,
  updateAccountRequestSchema,
} from "@solvia/contracts";
import { Hono } from "hono";
import type { AccountService } from "../../modules/accounts/account-service.ts";
import {
  accountBalanceToJson,
  accountChangesFromJson,
  accountToJson,
  newAccountFromJson,
} from "../mappers/account.ts";
import { validate } from "../validation.ts";

export function accountRoutes(service: AccountService) {
  return new Hono()
    .get("/", validate("query", listAccountsQuerySchema), (c) => {
      const items = service.list(c.req.valid("query")).map(accountToJson);
      return c.json({ items }, 200);
    })
    .post("/", validate("json", createAccountRequestSchema), (c) => {
      const record = service.create(newAccountFromJson(c.req.valid("json")));
      return c.json(accountToJson(record), 201);
    })
    .get("/:id", (c) => c.json(accountToJson(service.get(c.req.param("id"))), 200))
    .get("/:id/balance", (c) =>
      c.json(accountBalanceToJson(service.balance(c.req.param("id"))), 200),
    )
    .patch("/:id", validate("json", updateAccountRequestSchema), (c) => {
      const changes = accountChangesFromJson(c.req.valid("json"));
      return c.json(accountToJson(service.update(c.req.param("id"), changes)), 200);
    })
    .post("/:id/archive", (c) => c.json(accountToJson(service.archive(c.req.param("id"))), 200))
    .post("/:id/unarchive", (c) => c.json(accountToJson(service.unarchive(c.req.param("id"))), 200))
    .delete("/:id", (c) => {
      service.delete(c.req.param("id"));
      return c.body(null, 204);
    });
}
