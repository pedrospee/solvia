import type { CategoryNatureJson, CategoryResponse } from "@solvia/contracts";

export type CategoryNode = { category: CategoryResponse; children: CategoryResponse[] };

const collator = new Intl.Collator("pt-BR");
const byName = (left: CategoryResponse, right: CategoryResponse) =>
  collator.compare(left.name, right.name);

/**
 * The two-level tree of one nature, from the API's flat list (ADR-0003), by name at each
 * level. A child whose parent is not in the list is shown at the top level rather than lost.
 */
export function buildCategoryTree(
  categories: readonly CategoryResponse[],
  nature: CategoryNatureJson,
): CategoryNode[] {
  const ofNature = categories.filter((category) => category.nature === nature);
  const listed = new Set(ofNature.map((category) => category.id));

  return ofNature
    .filter((category) => category.parentId === null || !listed.has(category.parentId))
    .sort(byName)
    .map((category) => ({
      category,
      children: ofNature.filter((child) => child.parentId === category.id).sort(byName),
    }));
}

/**
 * The categories that may be chosen as the parent of `categoryId` (undefined when creating):
 * top-level, of the same nature, active, never itself. The current parent stays listed even
 * if archived, so the form shows what is saved. This only narrows the choice; the server
 * validates the resulting tree (BR-70, BR-71).
 */
export function parentOptions(
  categories: readonly CategoryResponse[],
  nature: CategoryNatureJson,
  categoryId: string | undefined,
  currentParentId: string | null,
): CategoryResponse[] {
  return categories
    .filter(
      (category) =>
        category.parentId === null &&
        category.nature === nature &&
        category.id !== categoryId &&
        (category.archivedAt === null || category.id === currentParentId),
    )
    .sort(byName);
}
