import styles from "./app.module.css";
import { ApiStatus } from "./health/api-status.tsx";

export function App() {
  return (
    <main className={styles.app}>
      <h1 className={styles.title}>Solvia</h1>
      <ApiStatus />
    </main>
  );
}
