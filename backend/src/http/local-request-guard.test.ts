import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "../infrastructure/database/test-fixtures.ts";
import { createApp } from "./app.ts";
import { localHosts } from "./local-request-guard.ts";

// The API has no authentication and trusts that only this machine reaches it
// (docs/security.md). A browser on this machine is the way around that: a malicious
// site can rebind its own domain to 127.0.0.1 (DNS rebinding) or send requests that
// need no CORS preflight (CSRF). These tests run against the real server's hosts.

const PORT = 3000;
const LOCAL = `http://127.0.0.1:${PORT}`;

let database: TestDatabase;
let app: ReturnType<typeof createApp>;

beforeEach(() => {
  database = createTestDatabase();
  app = createApp({ db: database.db, allowedHosts: localHosts(PORT) });
});

afterEach(() => {
  database.sqlite.close();
});

function request(path: string, init: RequestInit & { host?: string } = {}) {
  const { host = `127.0.0.1:${PORT}`, headers, ...rest } = init;
  return app.request(`${LOCAL}${path}`, { ...rest, headers: { Host: host, ...headers } });
}

async function createAccount(): Promise<string> {
  const response = await request("/api/accounts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Demo Bank", kind: "BANK", currency: "EUR" }),
  });
  return ((await response.json()) as { id: string }).id;
}

async function errorOf(response: Response) {
  const { error } = (await response.json()) as { error: { code: string } };
  return [response.status, error.code];
}

const accountCount = () => database.sqlite.prepare("SELECT count(*) FROM accounts").pluck().get();

describe("Host (DNS rebinding)", () => {
  it("serves requests addressed to the local server, by IP or by localhost", async () => {
    for (const host of [`127.0.0.1:${PORT}`, `localhost:${PORT}`, `LOCALHOST:${PORT}`]) {
      expect((await request("/api/health", { host })).status).toBe(200);
    }
  });

  it("rejects any other Host with 403 HOST_NOT_ALLOWED, before any route runs", async () => {
    const hosts = ["evil.example", `evil.example:${PORT}`, `127.0.0.1:${PORT + 1}`, "localhost"];

    for (const host of hosts) {
      expect(await errorOf(await request("/api/accounts", { host }))).toEqual([
        403,
        "HOST_NOT_ALLOWED",
      ]);
      const write = await request("/api/accounts", {
        host,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Rebound", kind: "BANK", currency: "EUR" }),
      });
      expect(await errorOf(write)).toEqual([403, "HOST_NOT_ALLOWED"]);
    }
    expect(await errorOf(await request("/api/no-such-route", { host: "evil.example" }))).toEqual([
      403,
      "HOST_NOT_ALLOWED",
    ]);
    expect(accountCount()).toBe(0n);
  });
});

describe("Origin (CSRF)", () => {
  it("rejects a change from another origin with 403 ORIGIN_NOT_ALLOWED, changing nothing", async () => {
    const id = await createAccount();

    for (const origin of ["https://evil.example", `http://evil.example:${PORT}`, "null"]) {
      // A POST without a body is a simple request: browsers send it without a preflight.
      const archive = await request(`/api/accounts/${id}/archive`, {
        method: "POST",
        headers: { Origin: origin },
      });
      expect(await errorOf(archive)).toEqual([403, "ORIGIN_NOT_ALLOWED"]);
      const remove = await request(`/api/accounts/${id}`, {
        method: "DELETE",
        headers: { Origin: origin },
      });
      expect(await errorOf(remove)).toEqual([403, "ORIGIN_NOT_ALLOWED"]);
    }
    const account = await (await request(`/api/accounts/${id}`)).json();
    expect(account).toMatchObject({ archivedAt: null });
  });

  it("accepts changes from the local origins and from clients that send no Origin", async () => {
    const id = await createAccount();

    for (const origin of [LOCAL, `http://localhost:${PORT}`]) {
      const response = await request(`/api/accounts/${id}/archive`, {
        method: "POST",
        headers: { Origin: origin },
      });
      expect(response.status).toBe(200);
    }
    expect((await request(`/api/accounts/${id}/unarchive`, { method: "POST" })).status).toBe(200);
  });

  it("leaves reads from another origin to the browser, which gets no CORS permission", async () => {
    const response = await request("/api/accounts", {
      headers: { Origin: "https://evil.example" },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});

describe("localHosts", () => {
  it("lists the two names of the loopback server, with its port", () => {
    expect(localHosts(4321)).toEqual(["127.0.0.1:4321", "localhost:4321"]);
  });
});
