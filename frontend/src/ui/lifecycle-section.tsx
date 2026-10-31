import { useState } from "react";
import { ErrorAlert } from "./error-alert.tsx";
import { texts as uiTexts } from "./texts.ts";
import styles from "./ui.module.css";

/** A change started by a button: what TanStack Query's useMutation returns, as far as used here. */
type Action = {
  mutate: (input: undefined, options?: { onSuccess?: () => void; onError?: () => void }) => void;
  isPending: boolean;
  error: unknown;
  reset: () => void;
};

export type LifecycleTexts = {
  title: string;
  hint: string;
  archive: string;
  unarchive: string;
  delete: string;
  deleteQuestion: string;
};

/**
 * Archive or unarchive, and delete after an inline confirmation: a browser dialog would be
 * neither styled nor testable. The API decides whether either is allowed; its refusal (an
 * item in use, active children…) is explained here. Starting one action clears the other's
 * result, so only the latest one is shown: a failed delete followed by a successful archive
 * must not still read as a failure.
 */
export function LifecycleSection({
  archived,
  toggleArchive,
  remove,
  onDeleted,
  texts,
}: {
  archived: boolean;
  toggleArchive: Action;
  remove: Action;
  onDeleted: () => void;
  texts: LifecycleTexts;
}) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  return (
    <section className={styles.section}>
      <h2>{texts.title}</h2>
      <p className={styles.notice}>{texts.hint}</p>
      <ErrorAlert error={toggleArchive.error ?? remove.error} />
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.secondary}
          disabled={toggleArchive.isPending}
          onClick={() => {
            remove.reset();
            toggleArchive.mutate(undefined);
          }}
        >
          {archived ? texts.unarchive : texts.archive}
        </button>
        {confirmingDelete ? (
          <>
            <span>{texts.deleteQuestion}</span>
            <button
              type="button"
              className={styles.danger}
              disabled={remove.isPending}
              onClick={() => {
                toggleArchive.reset();
                remove.mutate(undefined, {
                  onSuccess: onDeleted,
                  onError: () => setConfirmingDelete(false),
                });
              }}
            >
              {uiTexts.deleteConfirm}
            </button>
            <button
              type="button"
              className={styles.secondary}
              onClick={() => setConfirmingDelete(false)}
            >
              {uiTexts.deleteCancel}
            </button>
          </>
        ) : (
          <button type="button" className={styles.danger} onClick={() => setConfirmingDelete(true)}>
            {texts.delete}
          </button>
        )}
      </div>
    </section>
  );
}
