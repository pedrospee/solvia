import { errorMessage } from "../api/error-messages.ts";
import styles from "./ui.module.css";

/** A failed call, explained to the user; nothing while there is no error. */
export function ErrorAlert({ error }: { error: unknown }) {
  if (error === null || error === undefined) {
    return null;
  }
  return (
    <p role="alert" className={styles.alert}>
      {errorMessage(error)}
    </p>
  );
}
