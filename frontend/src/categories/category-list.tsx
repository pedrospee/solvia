import type { CategoryNatureJson, CategoryResponse } from "@solvia/contracts";
import { Link } from "react-router";
import { ErrorAlert } from "../ui/error-alert.tsx";
import { ArchivedTag, ShowArchivedToggle, useShowArchived } from "../ui/show-archived.tsx";
import ui from "../ui/ui.module.css";
import styles from "./categories.module.css";
import { useCategories } from "./category-queries.ts";
import { buildCategoryTree } from "./category-tree.ts";
import { groupTitles, texts } from "./texts.ts";

// Expenses first: they are most of what gets categorized.
const GROUP_ORDER: readonly CategoryNatureJson[] = ["EXPENSE", "INCOME"];

export function CategoryList() {
  const [includeArchived, setIncludeArchived] = useShowArchived();
  const categories = useCategories(includeArchived);

  return (
    <>
      <div className={ui.toolbar}>
        <h1>{texts.list.title}</h1>
        <ShowArchivedToggle checked={includeArchived} onChange={setIncludeArchived} />
        <Link to="/categorias/nova" className={ui.button}>
          {texts.list.newCategory}
        </Link>
      </div>
      {categories.isPending && <p role="status">{texts.list.loading}</p>}
      <ErrorAlert error={categories.error} />
      {categories.isSuccess &&
        (categories.data.items.length === 0 ? (
          <p>{texts.list.empty}</p>
        ) : (
          GROUP_ORDER.map((nature) => (
            <CategoryGroup key={nature} nature={nature} categories={categories.data.items} />
          ))
        ))}
    </>
  );
}

function CategoryGroup({
  nature,
  categories,
}: {
  nature: CategoryNatureJson;
  categories: CategoryResponse[];
}) {
  const tree = buildCategoryTree(categories, nature);
  return (
    <section className={ui.section} aria-label={groupTitles[nature]}>
      <h2>{groupTitles[nature]}</h2>
      {tree.length === 0 ? (
        <p className={ui.notice}>{texts.list.emptyGroup}</p>
      ) : (
        <ul className={styles.tree}>
          {tree.map(({ category, children }) => (
            <li key={category.id}>
              <div className={styles.parent}>
                <CategoryLink category={category} />
                {category.archivedAt === null && category.parentId === null && (
                  <Link
                    to={`/categorias/nova?pai=${category.id}`}
                    className={styles.addChild}
                    aria-label={texts.list.addChild(category.name)}
                  >
                    {texts.list.addChildShort}
                  </Link>
                )}
              </div>
              {children.length > 0 && (
                <ul className={styles.children}>
                  {children.map((child) => (
                    <li key={child.id}>
                      <CategoryLink category={child} />
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function CategoryLink({ category }: { category: CategoryResponse }) {
  return (
    <span>
      <Link to={`/categorias/${category.id}`}>{category.name}</Link>
      {category.archivedAt !== null && <ArchivedTag />}
    </span>
  );
}
