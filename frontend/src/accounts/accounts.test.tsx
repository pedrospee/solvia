import { screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { callApi } from "../api/call-api.ts";
import { formatAmount } from "../format/amount.ts";
import {
  asShown,
  createAccount,
  createTestApi,
  eur,
  recordOpeningBalance,
  renderApp,
  type TestApi,
} from "../test-fixtures.tsx";
import { texts as uiTexts } from "../ui/texts.ts";
import { texts } from "./texts.ts";

// Every test drives the real app against the real API in process (ADR-0005, D10).

let api: TestApi;

beforeEach(() => {
  api = createTestApi();
});

afterEach(() => {
  api.close();
});

async function accountsInApi(includeArchived = true) {
  const { items } = await callApi(
    api.client.api.accounts.$get({
      query: { includeArchived: includeArchived ? "true" : "false" },
    }),
  );
  return items;
}

const group = (name: string) => screen.findByRole("region", { name });

describe("account list", () => {
  it("invites the first account when there is none", async () => {
    renderApp(api.client, "/contas");

    expect(await screen.findByText(texts.list.empty)).toBeDefined();
    expect(screen.getByRole("link", { name: texts.list.newAccount }).getAttribute("href")).toBe(
      "/contas/nova",
    );
  });

  it("separates money held from money owed, each with its balance", async () => {
    const bank = await createAccount(api.client, { name: "Demo Bank", institution: "Example" });
    const card = await createAccount(api.client, { name: "Demo Card", kind: "CREDIT_CARD" });
    await recordOpeningBalance(api.client, bank.id, eur("250000"));
    await recordOpeningBalance(api.client, card.id, eur("43210"));

    renderApp(api.client, "/contas");

    const assets = await group(texts.list.assets);
    expect(within(assets).getByRole("link", { name: "Demo Bank" })).toBeDefined();
    expect(within(assets).getByText("Example")).toBeDefined();
    expect(await within(assets).findByText(asShown(formatAmount(eur("250000"))))).toBeDefined();

    const liabilities = await group(texts.list.liabilities);
    expect(within(liabilities).getByRole("columnheader", { name: texts.list.columns.owed }));
    expect(within(liabilities).getByText("Cartão de crédito")).toBeDefined();
    expect(await within(liabilities).findByText(asShown(formatAmount(eur("43210"))))).toBeDefined();
  });

  it("shows how much overdraft is in use, and by how much the limit is exceeded (BR-22)", async () => {
    const bank = await createAccount(api.client, { overdraftLimit: eur("100000") });
    await recordOpeningBalance(api.client, bank.id, eur("-120000"));

    renderApp(api.client, "/contas");

    expect(
      await screen.findByText(
        asShown(
          texts.balance.overdraftUsed(formatAmount(eur("120000")), formatAmount(eur("100000"))),
        ),
      ),
    ).toBeDefined();
    expect(
      screen.getByText(asShown(texts.balance.overdraftExceeded(formatAmount(eur("20000"))))),
    ).toBeDefined();
    expect(
      screen.getByText(asShown(texts.balance.available(formatAmount(eur("0"))))),
    ).toBeDefined();
  });
});

describe("creating an account", () => {
  it("creates a bank account with an overdraft limit typed the pt-BR way", async () => {
    const { user } = renderApp(api.client, "/contas/nova");

    await user.type(await screen.findByLabelText(texts.form.name), "  Banco Demo  ");
    await user.type(screen.getByLabelText(texts.form.institution), "Exemplo");
    await user.type(screen.getByLabelText(texts.form.overdraftLimit), "1.500,00");
    await user.click(screen.getByRole("button", { name: texts.create.submit }));

    expect(await screen.findByRole("heading", { name: texts.list.title })).toBeDefined();
    expect(await screen.findByRole("link", { name: "Banco Demo" })).toBeDefined();
    expect(await accountsInApi()).toMatchObject([
      {
        name: "Banco Demo",
        institution: "Exemplo",
        kind: "BANK",
        currency: "EUR",
        overdraftLimit: eur("150000"),
      },
    ]);
  });

  it("offers an overdraft limit only to bank accounts", async () => {
    const { user } = renderApp(api.client, "/contas/nova");

    await user.selectOptions(await screen.findByLabelText(texts.form.kind), "CREDIT_CARD");
    expect(screen.queryByLabelText(texts.form.overdraftLimit)).toBeNull();
    await user.selectOptions(screen.getByLabelText(texts.form.currency), "BRL");
    await user.type(screen.getByLabelText(texts.form.name), "Cartão Demo");
    await user.click(screen.getByRole("button", { name: texts.create.submit }));

    expect(await screen.findByRole("link", { name: "Cartão Demo" })).toBeDefined();
    expect(await accountsInApi()).toMatchObject([
      { kind: "CREDIT_CARD", currency: "BRL", overdraftLimit: null },
    ]);
  });

  it("explains a missing name or a malformed amount without calling the API", async () => {
    const { user } = renderApp(api.client, "/contas/nova");

    await user.type(await screen.findByLabelText(texts.form.overdraftLimit), "12.50");
    await user.click(screen.getByRole("button", { name: texts.create.submit }));

    expect(screen.getByText(texts.form.nameRequired)).toBeDefined();
    expect(screen.getByText(texts.form.amountInvalid)).toBeDefined();
    expect(screen.getByLabelText(texts.form.name).getAttribute("aria-invalid")).toBe("true");
    expect(await accountsInApi()).toEqual([]);
  });

  it("shows the server's refusal when a financial rule is broken", async () => {
    const { user } = renderApp(api.client, "/contas/nova");

    await user.type(await screen.findByLabelText(texts.form.name), "Banco Demo");
    // The form of "0" is fine; a limit must be above zero (BR-22), which only the server decides.
    await user.type(screen.getByLabelText(texts.form.overdraftLimit), "0");
    await user.click(screen.getByRole("button", { name: texts.create.submit }));

    expect((await screen.findByRole("alert")).textContent).toMatch(/^A conta não foi aceita/);
    expect(screen.getByRole("heading", { name: texts.create.title })).toBeDefined();
    expect(await accountsInApi()).toEqual([]);
  });
});

describe("account details", () => {
  it("edits the name, removes the institution and changes the limit", async () => {
    const bank = await createAccount(api.client, {
      institution: "Example",
      overdraftLimit: eur("50000"),
    });
    const { user } = renderApp(api.client, `/contas/${bank.id}`);

    const name = await screen.findByLabelText(texts.form.name);
    expect((screen.getByLabelText(texts.form.overdraftLimit) as HTMLInputElement).value).toBe(
      "500,00",
    );
    expect((screen.getByLabelText(texts.form.kind) as HTMLSelectElement).disabled).toBe(true);
    await user.clear(name);
    await user.type(name, "Conta Principal");
    await user.clear(screen.getByLabelText(texts.form.institution));
    await user.clear(screen.getByLabelText(texts.form.overdraftLimit));
    await user.type(screen.getByLabelText(texts.form.overdraftLimit), "2.000");
    await user.click(screen.getByRole("button", { name: texts.details.save }));

    expect(await screen.findByText(texts.details.saved)).toBeDefined();
    expect(await screen.findByRole("heading", { name: "Conta Principal" })).toBeDefined();
    expect(await accountsInApi()).toMatchObject([
      { name: "Conta Principal", institution: null, overdraftLimit: eur("200000") },
    ]);
  });

  it("archives an account out of the list, and back", async () => {
    const bank = await createAccount(api.client);
    const { user } = renderApp(api.client, `/contas/${bank.id}`);

    await user.click(await screen.findByRole("button", { name: texts.lifecycle.archive }));
    expect((await screen.findByRole("note")).textContent).toMatch(
      /^Conta arquivada em \d{2}\/\d{2}\/\d{4}\.$/,
    );
    expect(await accountsInApi(false)).toEqual([]);

    await user.click(screen.getByRole("link", { name: texts.details.back }));
    expect(await screen.findByText(texts.list.empty)).toBeDefined();
    await user.click(screen.getByLabelText(uiTexts.showArchived));
    const row = (await screen.findByRole("link", { name: "Demo Bank" })).closest("tr");
    expect(row && within(row).getByText(uiTexts.archived)).toBeDefined();

    await user.click(screen.getByRole("link", { name: "Demo Bank" }));
    await user.click(await screen.findByRole("button", { name: texts.lifecycle.unarchive }));
    expect(await screen.findByRole("button", { name: texts.lifecycle.archive })).toBeDefined();
    expect(screen.queryByRole("note")).toBeNull();
    expect(await accountsInApi(false)).toHaveLength(1);
  });

  it("deletes an unused account after confirmation", async () => {
    const bank = await createAccount(api.client);
    const { user } = renderApp(api.client, `/contas/${bank.id}`);

    await user.click(await screen.findByRole("button", { name: texts.lifecycle.delete }));
    await user.click(screen.getByRole("button", { name: uiTexts.deleteCancel }));
    expect(await accountsInApi()).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: texts.lifecycle.delete }));
    expect(screen.getByText(texts.lifecycle.deleteQuestion)).toBeDefined();
    await user.click(screen.getByRole("button", { name: uiTexts.deleteConfirm }));

    expect(await screen.findByText(texts.list.empty)).toBeDefined();
    expect(await accountsInApi()).toEqual([]);
  });

  it("explains that an account with transactions is archived, not deleted", async () => {
    const bank = await createAccount(api.client);
    await recordOpeningBalance(api.client, bank.id, eur("1000"));
    const { user } = renderApp(api.client, `/contas/${bank.id}`);

    await user.click(await screen.findByRole("button", { name: texts.lifecycle.delete }));
    await user.click(screen.getByRole("button", { name: uiTexts.deleteConfirm }));

    expect((await screen.findByRole("alert")).textContent).toMatch(/^Esta conta tem transações/);
    expect(screen.getByRole("button", { name: texts.lifecycle.delete })).toBeDefined();
    expect(await accountsInApi()).toHaveLength(1);
  });

  it("says so when the account does not exist", async () => {
    renderApp(api.client, "/contas/no-such-account");

    expect((await screen.findByRole("alert")).textContent).toMatch(/^Conta não encontrada/);
  });
});
