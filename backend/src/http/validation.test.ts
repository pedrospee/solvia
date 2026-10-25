import { Hono } from "hono";
import { hc, type InferRequestType } from "hono/client";
import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";
import { errorHandler } from "./error-handler.ts";
import { validate } from "./validation.ts";

// A test-only contract with a transform, so input and output types differ.
const noteSchema = z.strictObject({
  title: z.string().min(1),
  amountMinor: z.string().transform((value) => BigInt(value)),
});

function testApp() {
  const app = new Hono()
    .post("/notes", validate("json", noteSchema), (c) => {
      const note = c.req.valid("json");
      return c.json({ title: note.title, isBigint: typeof note.amountMinor === "bigint" });
    })
    .get("/search", validate("query", z.strictObject({ q: z.string().min(2) })), (c) =>
      c.json({ q: c.req.valid("query").q }),
    );
  app.onError(errorHandler);
  return app;
}

function postJson(body: unknown) {
  return testApp().request("/notes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("validate", () => {
  it("passes the parsed, transformed value to the route", async () => {
    const response = await postJson({ title: "Fictitious", amountMinor: "1050" });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ title: "Fictitious", isBigint: true });
  });

  it("rejects a body that does not match the contract with 400 and the Zod issues", async () => {
    const response = await postJson({ title: "", amountMinor: "1050", extra: true });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toMatchObject({
      error: {
        code: "VALIDATION_FAILED",
        message: "The request does not match the API contract.",
        details: {
          issues: expect.arrayContaining([
            expect.objectContaining({ path: ["title"] }),
            expect.objectContaining({ code: "unrecognized_keys", keys: ["extra"] }),
          ]),
        },
      },
    });
  });

  it("rejects a JSON body sent without a JSON Content-Type with 400 INVALID_REQUEST", async () => {
    // Hono's validator reads such a body as {}, which an all-optional schema would accept.
    const body = JSON.stringify({ title: "Fictitious", amountMinor: "1050" });
    const requests = [{ body }, { headers: { "Content-Type": "text/plain" }, body }];

    for (const init of requests) {
      const response = await testApp().request("/notes", { method: "POST", ...init });

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        error: { code: "INVALID_REQUEST", message: "The request body must be JSON." },
      });
    }
  });

  it("accepts a JSON Content-Type with parameters", async () => {
    const response = await testApp().request("/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ title: "Fictitious", amountMinor: "1050" }),
    });

    expect(response.status).toBe(200);
  });

  it("validates other request parts, such as the query string", async () => {
    const ok = await testApp().request("/search?q=rent");
    const invalid = await testApp().request("/search?q=r");

    expect(await ok.json()).toEqual({ q: "rent" });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ error: { code: "VALIDATION_FAILED" } });
  });

  it("exposes the schema's input type to hono/client through the app type", () => {
    const client = hc<ReturnType<typeof testApp>>("http://localhost");

    expectTypeOf<InferRequestType<typeof client.notes.$post>>().toEqualTypeOf<{
      json: { title: string; amountMinor: string };
    }>();
  });
});
