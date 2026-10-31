import { type CategoryResponse, updateCategoryRequestSchema } from "@solvia/contracts";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ApiRequestError, callApi } from "../api/call-api.ts";
import { useApiMutation } from "../api/use-api-mutation.ts";
import { formatTimestampDate } from "../format/date.ts";
import { ErrorAlert } from "../ui/error-alert.tsx";
import { LifecycleSection } from "../ui/lifecycle-section.tsx";
import { ArchivedTag } from "../ui/show-archived.tsx";
import ui from "../ui/ui.module.css";
import { CategoryForm, type CategoryFormValues } from "./category-form.tsx";
import { categoryKeys, useCategories, useCategory } from "./category-queries.ts";
import { natureLabels, texts } from "./texts.ts";

export function CategoryDetails() {
  const { id = "" } = useParams();
  const category = useCategory(id);
  // Every category, archived ones too: the parent's name, the children, the parent options.
  const categories = useCategories(true);

  return (
    <>
      <p>
        <Link to="/categorias">{texts.details.back}</Link>
      </p>
      {(category.isPending || categories.isPending) && <p role="status">{texts.details.loading}</p>}
      <ErrorAlert error={category.error ?? categories.error} />
      {category.isSuccess && categories.isSuccess && (
        <CategoryPage category={category.data} categories={categories.data.items} />
      )}
    </>
  );
}

function CategoryPage({
  category,
  categories,
}: {
  category: CategoryResponse;
  categories: CategoryResponse[];
}) {
  const [saved, setSaved] = useState(false);
  const parent = categories.find(({ id }) => id === category.parentId);
  const children = categories.filter(({ parentId }) => parentId === category.id);
  const update = useApiMutation(categoryKeys.all, (api, values: CategoryFormValues) => {
    const request = updateCategoryRequestSchema.safeParse({
      name: values.name,
      parentId: values.parentId,
    });
    if (!request.success) {
      throw new ApiRequestError(400, "VALIDATION_FAILED", request.error.message);
    }
    return callApi(
      api.api.categories[":id"].$patch({ param: { id: category.id }, json: request.data }),
    );
  });

  return (
    <>
      <h1>{category.name}</h1>
      <p className={ui.notice}>
        {natureLabels[category.nature]}
        {parent !== undefined && (
          <>
            {" · "}
            {texts.details.childOf} <Link to={`/categorias/${parent.id}`}>{parent.name}</Link>
          </>
        )}
      </p>
      {category.archivedAt !== null && (
        <p role="note">{texts.details.archivedOn(formatTimestampDate(category.archivedAt))}</p>
      )}

      {children.length > 0 && (
        <section className={ui.section}>
          <h2>{texts.details.childrenTitle}</h2>
          <ul>
            {children.map((child) => (
              <li key={child.id}>
                <Link to={`/categorias/${child.id}`}>{child.name}</Link>
                {child.archivedAt !== null && <ArchivedTag />}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className={ui.section}>
        <h2>{texts.details.editTitle}</h2>
        <ErrorAlert error={update.error} />
        {saved && <p role="status">{texts.details.saved}</p>}
        <CategoryForm
          // Keyed by the last change, so the form starts again from what the server saved.
          key={category.updatedAt}
          initial={{ name: category.name, nature: category.nature, parentId: category.parentId }}
          categoryId={category.id}
          categories={categories}
          hasChildren={children.length > 0}
          submitLabel={texts.details.save}
          pendingLabel={texts.details.saving}
          pending={update.isPending}
          onSubmit={(values) => {
            setSaved(false);
            update.mutate(values, { onSuccess: () => setSaved(true) });
          }}
        />
      </section>

      <Lifecycle category={category} />
    </>
  );
}

function Lifecycle({ category }: { category: CategoryResponse }) {
  const navigate = useNavigate();
  const archived = category.archivedAt !== null;
  const param = { param: { id: category.id } };
  const toggleArchive = useApiMutation(categoryKeys.all, (api) =>
    callApi(
      archived
        ? api.api.categories[":id"].unarchive.$post(param)
        : api.api.categories[":id"].archive.$post(param),
    ),
  );
  const remove = useApiMutation(categoryKeys.all, (api) =>
    callApi(api.api.categories[":id"].$delete(param)),
  );

  return (
    <LifecycleSection
      archived={archived}
      toggleArchive={toggleArchive}
      remove={remove}
      onDeleted={() => navigate("/categorias")}
      texts={texts.lifecycle}
    />
  );
}
