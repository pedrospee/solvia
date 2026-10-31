import { type CategoryResponse, createCategoryRequestSchema } from "@solvia/contracts";
import { Link, useNavigate, useSearchParams } from "react-router";
import { ApiRequestError, callApi } from "../api/call-api.ts";
import { useApiMutation } from "../api/use-api-mutation.ts";
import { ErrorAlert } from "../ui/error-alert.tsx";
import { CategoryForm, type CategoryFormValues } from "./category-form.tsx";
import { categoryKeys, useCategories } from "./category-queries.ts";
import { parentOptions } from "./category-tree.ts";
import { texts } from "./texts.ts";

/** ?pai=<id>, from "add a subcategory", starts the form under that parent. */
function initialValues(
  categories: CategoryResponse[],
  parentId: string | null,
): CategoryFormValues {
  const parent = categories.find((category) => category.id === parentId);
  if (
    parent !== undefined &&
    parentOptions(categories, parent.nature, undefined, null).includes(parent)
  ) {
    return { name: "", nature: parent.nature, parentId: parent.id };
  }
  return { name: "", nature: "EXPENSE", parentId: null };
}

export function NewCategory() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const categories = useCategories(true);
  const create = useApiMutation(categoryKeys.all, (api, values: CategoryFormValues) => {
    const request = createCategoryRequestSchema.safeParse({
      name: values.name,
      nature: values.nature,
      ...(values.parentId === null ? {} : { parentId: values.parentId }),
    });
    if (!request.success) {
      throw new ApiRequestError(400, "VALIDATION_FAILED", request.error.message);
    }
    return callApi(api.api.categories.$post({ json: request.data }));
  });

  return (
    <>
      <h1>{texts.create.title}</h1>
      <ErrorAlert error={categories.error ?? create.error} />
      {categories.isSuccess && (
        <CategoryForm
          initial={initialValues(categories.data.items, searchParams.get("pai"))}
          categoryId={undefined}
          categories={categories.data.items}
          hasChildren={false}
          submitLabel={texts.create.submit}
          pendingLabel={texts.create.pending}
          pending={create.isPending}
          onSubmit={(values) => create.mutate(values, { onSuccess: () => navigate("/categorias") })}
        >
          <Link to="/categorias">{texts.create.cancel}</Link>
        </CategoryForm>
      )}
    </>
  );
}
