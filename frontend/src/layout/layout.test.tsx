import { screen } from "@testing-library/react";
import { afterAll, describe, expect, it } from "vitest";
import { texts as accountTexts } from "../accounts/texts.ts";
import { texts as healthTexts } from "../health/texts.ts";
import { createTestApi, renderApp } from "../test-fixtures.tsx";
import { texts } from "./texts.ts";

const api = createTestApi();

afterAll(() => {
  api.close();
});

describe("layout and routes", () => {
  it("opens on the accounts, with the navigation and the API status", async () => {
    renderApp(api.client, "/");

    expect(await screen.findByRole("heading", { name: accountTexts.list.title })).toBeDefined();
    const navigation = screen.getByRole("navigation", { name: texts.navigation });
    expect(navigation.querySelector('[aria-current="page"]')?.textContent).toBe(texts.accounts);
    expect(await screen.findByText(healthTexts.connected)).toBeDefined();
  });

  it("answers an unknown address with a way back", async () => {
    renderApp(api.client, "/nada-aqui");

    expect(await screen.findByRole("heading", { name: texts.notFound })).toBeDefined();
    expect(screen.getByRole("link", { name: texts.backHome }).getAttribute("href")).toBe("/contas");
  });
});
