import { screen } from "@testing-library/react";
import { afterAll, describe, expect, it } from "vitest";
import { createTestApi, createUnreachableApi, renderWithApi } from "../test-fixtures.tsx";
import { ApiStatus } from "./api-status.tsx";
import { texts } from "./texts.ts";

const api = createTestApi();

afterAll(() => {
  api.close();
});

describe("ApiStatus", () => {
  it("says it is checking, then that the API is connected", async () => {
    renderWithApi(<ApiStatus />, api.client);

    expect(screen.getByRole("status").textContent).toBe(texts.checking);
    expect(await screen.findByText(texts.connected)).toBeDefined();
  });

  it("alerts when the API cannot be reached", async () => {
    renderWithApi(<ApiStatus />, createUnreachableApi());

    expect((await screen.findByRole("alert")).textContent).toBe(texts.unreachable);
  });
});
