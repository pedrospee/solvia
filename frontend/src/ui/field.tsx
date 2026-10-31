import { type ReactNode, useId } from "react";
import styles from "./ui.module.css";

/** What the input of a Field spreads: its id, and the hint or error that describes it. */
export type FieldControlProps = {
  id: string;
  "aria-describedby"?: string;
  "aria-invalid"?: true;
};

/** A labelled input, with its hint or, once the input is refused, its error. */
export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
  children: (control: FieldControlProps) => ReactNode;
}) {
  const id = useId();
  const descriptionId = `${id}-description`;
  const description = error ?? hint;

  return (
    <div className={styles.field}>
      <label htmlFor={id} className={styles.label}>
        {label}
      </label>
      {children({
        id,
        ...(description === undefined ? {} : { "aria-describedby": descriptionId }),
        ...(error === undefined ? {} : { "aria-invalid": true }),
      })}
      {description !== undefined && (
        <span id={descriptionId} className={error === undefined ? styles.hint : styles.fieldError}>
          {description}
        </span>
      )}
    </div>
  );
}
