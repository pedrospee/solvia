import type { CategoryResponse } from "@solvia/contracts";
import { describe, expect, it } from "vitest";
import { buildCategoryTree, parentOptions } from "./category-tree.ts";

function category(
  id: string,
  name: string,
  changes: Partial<CategoryResponse> = {},
): CategoryResponse {
  return {
    id,
    name,
    nature: "EXPENSE",
    parentId: null,
    archivedAt: null,
    createdAt: "2026-10-01T10:00:00.000Z",
    updatedAt: "2026-10-01T10:00:00.000Z",
    ...changes,
  };
}

const food = category("food", "Alimentação");
const market = category("market", "Mercado", { parentId: "food" });
const bakery = category("bakery", "Padaria", { parentId: "food" });
const home = category("home", "Casa");
const salary = category("salary", "Salário", { nature: "INCOME" });

describe("buildCategoryTree", () => {
  it("nests children under their parent, sorted by name at each level, one nature at a time", () => {
    const tree = buildCategoryTree([home, bakery, salary, market, food], "EXPENSE");

    expect(
      tree.map(({ category: { name }, children }) => [name, children.map((c) => c.name)]),
    ).toEqual([
      ["Alimentação", ["Mercado", "Padaria"]],
      ["Casa", []],
    ]);
    expect(buildCategoryTree([home, salary], "INCOME").map((node) => node.category.name)).toEqual([
      "Salário",
    ]);
  });

  it("sorts the pt-BR way, accents included", () => {
    const names = ["Óculos", "Ônibus", "Academia", "Água"].map((name) => category(name, name));

    expect(buildCategoryTree(names, "EXPENSE").map((node) => node.category.name)).toEqual([
      "Academia",
      "Água",
      "Óculos",
      "Ônibus",
    ]);
  });

  it("keeps a child whose parent is not listed, at the top level", () => {
    expect(buildCategoryTree([market], "EXPENSE")).toEqual([{ category: market, children: [] }]);
  });
});

describe("parentOptions", () => {
  const archivedTop = category("old", "Antiga", { archivedAt: "2026-10-02T10:00:00.000Z" });
  const all = [food, market, home, salary, archivedTop];

  it("offers active top-level categories of the same nature", () => {
    expect(parentOptions(all, "EXPENSE", undefined, null).map((c) => c.id)).toEqual([
      "food",
      "home",
    ]);
    expect(parentOptions(all, "INCOME", undefined, null).map((c) => c.id)).toEqual(["salary"]);
  });

  it("never offers the category itself, and keeps its current parent even if archived", () => {
    expect(parentOptions(all, "EXPENSE", "home", null).map((c) => c.id)).toEqual(["food"]);
    expect(parentOptions(all, "EXPENSE", "x", "old").map((c) => c.id)).toEqual([
      "food",
      "old",
      "home",
    ]);
  });
});
