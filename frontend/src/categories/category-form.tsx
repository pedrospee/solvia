import {
  type CategoryNatureJson,
  type CategoryResponse,
  categoryNatureSchema,
} from "@solvia/contracts";
import { type FormEvent, type ReactNode, useState } from "react";
import { Field } from "../ui/field.tsx";
import ui from "../ui/ui.module.css";
import { parentOptions } from "./category-tree.ts";
import { natureLabels, texts } from "./texts.ts";

export type CategoryFormValues = {
  name: string;
  nature: CategoryNatureJson;
  parentId: string | null;
};

/**
 * The fields of a category. The parent list is narrowed to what the hierarchy allows, but
 * the server still validates the whole tree (BR-70, BR-71) and its refusal is shown by the
 * page (ADR-0005, D6). The nature can be chosen only when creating.
 */
export function CategoryForm({
  initial,
  categoryId,
  categories,
  hasChildren,
  submitLabel,
  pendingLabel,
  pending,
  onSubmit,
  children,
}: {
  initial: CategoryFormValues;
  /** The category being edited; undefined when creating. */
  categoryId: string | undefined;
  /** Every category, archived ones included, to choose the parent from. */
  categories: readonly CategoryResponse[];
  hasChildren: boolean;
  submitLabel: string;
  pendingLabel: string;
  pending: boolean;
  onSubmit: (values: CategoryFormValues) => void;
  children?: ReactNode;
}) {
  const [name, setName] = useState(initial.name);
  const [nature, setNature] = useState(initial.nature);
  const [parentId, setParentId] = useState(initial.parentId);
  const [nameError, setNameError] = useState<string>();
  const creating = categoryId === undefined;
  const parents = parentOptions(categories, nature, categoryId, initial.parentId);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (name.trim() === "") {
      setNameError(texts.form.nameRequired);
      return;
    }
    setNameError(undefined);
    onSubmit({ name: name.trim(), nature, parentId });
  }

  return (
    <form className={ui.form} onSubmit={submit} noValidate>
      <Field label={texts.form.name} error={nameError}>
        {(control) => (
          <input {...control} value={name} onChange={(event) => setName(event.target.value)} />
        )}
      </Field>
      <Field label={texts.form.nature} hint={creating ? undefined : texts.form.fixedNature}>
        {(control) => (
          <select
            {...control}
            value={nature}
            disabled={!creating}
            onChange={(event) => {
              setNature(categoryNatureSchema.parse(event.target.value));
              // A parent of the other nature would break BR-70.
              setParentId(null);
            }}
          >
            {categoryNatureSchema.options.map((option) => (
              <option key={option} value={option}>
                {natureLabels[option]}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field
        label={texts.form.parent}
        hint={hasChildren ? texts.form.hasChildren : texts.form.parentHint}
      >
        {(control) => (
          <select
            {...control}
            value={parentId ?? ""}
            disabled={hasChildren}
            onChange={(event) => setParentId(event.target.value === "" ? null : event.target.value)}
          >
            <option value="">{texts.form.noParent}</option>
            {parents.map((parent) => (
              <option key={parent.id} value={parent.id}>
                {parent.archivedAt === null ? parent.name : texts.form.archivedParent(parent.name)}
              </option>
            ))}
          </select>
        )}
      </Field>
      <div className={ui.actions}>
        <button type="submit" className={ui.button} disabled={pending}>
          {pending ? pendingLabel : submitLabel}
        </button>
        {children}
      </div>
    </form>
  );
}
