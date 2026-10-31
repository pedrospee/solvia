import { screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { callApi } from "../api/call-api.ts";
import {
  createAccount,
  createCategory,
  createTestApi,
  eur,
  recordExpense,
  renderApp,
  type TestApi,
} from "../test-fixtures.tsx";
import { texts as uiTexts } from "../ui/texts.ts";
import { groupTitles, texts } from "./texts.ts";

// Every test drives the real app against the real API in process (ADR-0005, D10).

let api: TestApi;

beforeEach(() => {
  api = createTestApi();
});

afterEach(() => {
  api.close();
});

/** Every category, by name: the API lists them by creation time, then by random id. */
async function categoriesInApi() {
  const { items } = await callApi(
    api.client.api.categories.$get({ query: { includeArchived: "true" } }),
  );
  return items.sort((left, right) => left.name.localeCompare(right.name, "pt-BR"));
}

const archive = (id: string) =>
  callApi(api.client.api.categories[":id"].archive.$post({ param: { id } }));

/** The visible text of each option of a select. */
function optionsOf(select: HTMLElement): string[] {
  return [...(select as HTMLSelectElement).options].map((option) => option.text);
}

describe("category list", () => {
  it("invites the first category when there is none", async () => {
    renderApp(api.client, "/categorias");

    expect(await screen.findByText(texts.list.empty)).toBeDefined();
  });

  it("shows each nature as a two-level tree, sorted by name (BR-70, BR-71)", async () => {
    const food = await createCategory(api.client, { name: "Alimentação" });
    await createCategory(api.client, { name: "Restaurante", parentId: food.id });
    await createCategory(api.client, { name: "Mercado", parentId: food.id });
    await createCategory(api.client, { name: "Casa" });
    await createCategory(api.client, { name: "Salário", nature: "INCOME" });

    renderApp(api.client, "/categorias");

    const expenses = await screen.findByRole("region", { name: groupTitles.EXPENSE });
    const [first, second] = within(expenses)
      .getAllByRole("listitem")
      .filter((item) => item.parentElement === expenses.querySelector("ul"));
    expect(
      first &&
        within(first)
          .getAllByRole("link")
          .map((link) => link.textContent),
    ).toEqual(["Alimentação", "+ subcategoria", "Mercado", "Restaurante"]);
    expect(second && within(second).getByRole("link", { name: "Casa" })).toBeDefined();

    const income = screen.getByRole("region", { name: groupTitles.INCOME });
    expect(within(income).getByRole("link", { name: "Salário" })).toBeDefined();
    expect(within(income).queryByRole("link", { name: "Casa" })).toBeNull();
  });

  it("shows archived categories only on request", async () => {
    const old = await createCategory(api.client, { name: "Antiga" });
    await archive(old.id);
    const { user } = renderApp(api.client, "/categorias");

    expect(await screen.findByText(texts.list.empty)).toBeDefined();
    await user.click(screen.getByLabelText(uiTexts.showArchived));

    const link = await screen.findByRole("link", { name: "Antiga" });
    expect(within(link.parentElement as HTMLElement).getByText(uiTexts.archived)).toBeDefined();
    // An archived category cannot take new children.
    expect(screen.queryByRole("link", { name: texts.list.addChild("Antiga") })).toBeNull();
  });
});

describe("creating a category", () => {
  it("creates a top-level category of the chosen nature", async () => {
    const { user } = renderApp(api.client, "/categorias/nova");

    await user.type(await screen.findByLabelText(texts.form.name), "  Freelance ");
    await user.selectOptions(screen.getByLabelText(texts.form.nature), "INCOME");
    await user.click(screen.getByRole("button", { name: texts.create.submit }));

    expect(await screen.findByRole("link", { name: "Freelance" })).toBeDefined();
    expect(await categoriesInApi()).toMatchObject([
      { name: "Freelance", nature: "INCOME", parentId: null },
    ]);
  });

  it("adds a subcategory from its parent, starting with the parent's nature", async () => {
    const salary = await createCategory(api.client, { name: "Salário", nature: "INCOME" });
    const { user } = renderApp(api.client, "/categorias");

    await user.click(await screen.findByRole("link", { name: texts.list.addChild("Salário") }));
    expect((await screen.findByLabelText<HTMLSelectElement>(texts.form.nature)).value).toBe(
      "INCOME",
    );
    expect(screen.getByLabelText<HTMLSelectElement>(texts.form.parent).value).toBe(salary.id);
    await user.type(screen.getByLabelText(texts.form.name), "Bônus");
    await user.click(screen.getByRole("button", { name: texts.create.submit }));

    expect(await screen.findByRole("link", { name: "Bônus" })).toBeDefined();
    expect(await categoriesInApi()).toMatchObject([
      { name: "Bônus", nature: "INCOME", parentId: salary.id },
      { name: "Salário" },
    ]);
  });

  it("offers as parents only active top-level categories of the same nature", async () => {
    const food = await createCategory(api.client, { name: "Alimentação" });
    await createCategory(api.client, { name: "Mercado", parentId: food.id });
    const old = await createCategory(api.client, { name: "Antiga" });
    await archive(old.id);
    await createCategory(api.client, { name: "Salário", nature: "INCOME" });
    const { user } = renderApp(api.client, "/categorias/nova");

    const parent = await screen.findByLabelText(texts.form.parent);
    expect(optionsOf(parent)).toEqual([texts.form.noParent, "Alimentação"]);

    await user.selectOptions(parent, food.id);
    await user.selectOptions(screen.getByLabelText(texts.form.nature), "INCOME");
    expect(screen.getByLabelText<HTMLSelectElement>(texts.form.parent).value).toBe("");
    expect(optionsOf(screen.getByLabelText(texts.form.parent))).toEqual([
      texts.form.noParent,
      "Salário",
    ]);
  });

  it("asks for a name without calling the API", async () => {
    const { user } = renderApp(api.client, "/categorias/nova");

    await user.click(await screen.findByRole("button", { name: texts.create.submit }));

    expect(screen.getByText(texts.form.nameRequired)).toBeDefined();
    expect(await categoriesInApi()).toEqual([]);
  });
});

describe("category details", () => {
  it("renames a subcategory and moves it to the top level", async () => {
    const food = await createCategory(api.client, { name: "Alimentação" });
    const market = await createCategory(api.client, { name: "Mercado", parentId: food.id });
    const { user } = renderApp(api.client, `/categorias/${market.id}`);

    expect(await screen.findByRole("link", { name: "Alimentação" })).toBeDefined();
    expect(screen.getByLabelText<HTMLSelectElement>(texts.form.nature).disabled).toBe(true);
    const name = screen.getByLabelText(texts.form.name);
    await user.clear(name);
    await user.type(name, "Supermercado");
    await user.selectOptions(screen.getByLabelText(texts.form.parent), "");
    await user.click(screen.getByRole("button", { name: texts.details.save }));

    expect(await screen.findByText(texts.details.saved)).toBeDefined();
    expect(await screen.findByRole("heading", { name: "Supermercado" })).toBeDefined();
    expect(await categoriesInApi()).toMatchObject([
      { name: "Alimentação" },
      { name: "Supermercado", parentId: null },
    ]);
  });

  it("keeps a category with children at the top level, and lists them (BR-71)", async () => {
    const food = await createCategory(api.client, { name: "Alimentação" });
    await createCategory(api.client, { name: "Mercado", parentId: food.id });
    await createCategory(api.client, { name: "Casa" });
    renderApp(api.client, `/categorias/${food.id}`);

    const parent = await screen.findByLabelText<HTMLSelectElement>(texts.form.parent);
    expect(parent.disabled).toBe(true);
    expect(screen.getByText(texts.form.hasChildren)).toBeDefined();
    const children = screen.getByRole("heading", { name: texts.details.childrenTitle })
      .nextElementSibling as HTMLElement;
    expect(within(children).getByRole("link", { name: "Mercado" })).toBeDefined();
  });

  it("explains why a parent with active children cannot be archived", async () => {
    const food = await createCategory(api.client, { name: "Alimentação" });
    await createCategory(api.client, { name: "Mercado", parentId: food.id });
    const { user } = renderApp(api.client, `/categorias/${food.id}`);

    await user.click(await screen.findByRole("button", { name: texts.lifecycle.archive }));

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Arquive as subcategorias antes de arquivar a categoria principal.",
    );
  });

  it("explains why a child cannot be unarchived under an archived parent", async () => {
    const food = await createCategory(api.client, { name: "Alimentação" });
    const market = await createCategory(api.client, { name: "Mercado", parentId: food.id });
    await archive(market.id);
    await archive(food.id);
    const { user } = renderApp(api.client, `/categorias/${market.id}`);

    expect((await screen.findByRole("note")).textContent).toMatch(/^Categoria arquivada em/);
    await user.click(screen.getByRole("button", { name: texts.lifecycle.unarchive }));

    expect((await screen.findByRole("alert")).textContent).toMatch(
      /^A categoria principal está arquivada/,
    );
  });

  it("shows only the latest action's result, never an earlier failure", async () => {
    const food = await createCategory(api.client, { name: "Alimentação" });
    const market = await createCategory(api.client, { name: "Mercado", parentId: food.id });
    await archive(market.id);
    const { user } = renderApp(api.client, `/categorias/${food.id}`);

    // Delete fails: the category still has a (now archived) child.
    await user.click(await screen.findByRole("button", { name: texts.lifecycle.delete }));
    await user.click(screen.getByRole("button", { name: uiTexts.deleteConfirm }));
    expect((await screen.findByRole("alert")).textContent).toMatch(
      /^Esta categoria tem subcategorias e não pode ser excluída/,
    );

    // Archiving then succeeds, since no child is active: the delete error must go.
    await user.click(screen.getByRole("button", { name: texts.lifecycle.archive }));
    expect((await screen.findByRole("note")).textContent).toMatch(/^Categoria arquivada em/);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("replaces an earlier failure with the latest one", async () => {
    const food = await createCategory(api.client, { name: "Alimentação" });
    await createCategory(api.client, { name: "Mercado", parentId: food.id });
    const { user } = renderApp(api.client, `/categorias/${food.id}`);

    await user.click(await screen.findByRole("button", { name: texts.lifecycle.archive }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/^Arquive as subcategorias/);

    await user.click(screen.getByRole("button", { name: texts.lifecycle.delete }));
    await user.click(screen.getByRole("button", { name: uiTexts.deleteConfirm }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(
        /^Esta categoria tem subcategorias e não pode ser excluída/,
      ),
    );
  });

  it("deletes an unused category after confirmation", async () => {
    const home = await createCategory(api.client, { name: "Casa" });
    const { user } = renderApp(api.client, `/categorias/${home.id}`);

    await user.click(await screen.findByRole("button", { name: texts.lifecycle.delete }));
    await user.click(screen.getByRole("button", { name: uiTexts.deleteConfirm }));

    expect(await screen.findByText(texts.list.empty)).toBeDefined();
    expect(await categoriesInApi()).toEqual([]);
  });

  it("explains why a category with children or transactions is not deleted", async () => {
    const food = await createCategory(api.client, { name: "Alimentação" });
    const market = await createCategory(api.client, { name: "Mercado", parentId: food.id });
    const account = await createAccount(api.client);
    await recordExpense(api.client, account.id, market.id, eur("1250"));

    const parentPage = renderApp(api.client, `/categorias/${food.id}`);
    await parentPage.user.click(
      await screen.findByRole("button", { name: texts.lifecycle.delete }),
    );
    await parentPage.user.click(screen.getByRole("button", { name: uiTexts.deleteConfirm }));
    expect((await screen.findByRole("alert")).textContent).toMatch(
      /^Esta categoria tem subcategorias/,
    );
    parentPage.unmount();

    const childPage = renderApp(api.client, `/categorias/${market.id}`);
    await childPage.user.click(await screen.findByRole("button", { name: texts.lifecycle.delete }));
    await childPage.user.click(screen.getByRole("button", { name: uiTexts.deleteConfirm }));
    expect((await screen.findByRole("alert")).textContent).toMatch(
      /^Esta categoria tem transações/,
    );
    expect(await categoriesInApi()).toHaveLength(2);
  });

  it("says so when the category does not exist", async () => {
    renderApp(api.client, "/categorias/no-such-category");

    expect((await screen.findByRole("alert")).textContent).toMatch(/^Categoria não encontrada/);
  });
});
