import { useSearchParams } from "react-router";
import { texts } from "./texts.ts";
import styles from "./ui.module.css";

// ?arquivadas=1 keeps the choice in the URL, so a reload or the back button keeps it.
const SHOW_ARCHIVED = "arquivadas";

/** Whether a list shows archived items too, and how to change it. */
export function useShowArchived(): [boolean, (show: boolean) => void] {
  const [searchParams, setSearchParams] = useSearchParams();
  return [
    searchParams.get(SHOW_ARCHIVED) === "1",
    (show) => setSearchParams(show ? { [SHOW_ARCHIVED]: "1" } : {}, { replace: true }),
  ];
}

export function ShowArchivedToggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (show: boolean) => void;
}) {
  return (
    <label className={styles.checkbox}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      {texts.showArchived}
    </label>
  );
}

export function ArchivedTag() {
  return <span className={styles.tag}>{texts.archived}</span>;
}
