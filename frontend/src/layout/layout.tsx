import { NavLink, Outlet } from "react-router";
import { ApiStatus } from "../health/api-status.tsx";
import styles from "./layout.module.css";
import { texts } from "./texts.ts";

/** The frame of every page: name, navigation, API status, then the page itself. */
export function Layout() {
  return (
    <>
      <header className={styles.header}>
        <p className={styles.brand}>{texts.appName}</p>
        <nav aria-label={texts.navigation} className={styles.nav}>
          <NavLink to="/contas">{texts.accounts}</NavLink>
          <NavLink to="/categorias">{texts.categories}</NavLink>
        </nav>
        <div className={styles.status}>
          <ApiStatus />
        </div>
      </header>
      <main className={styles.main}>
        <Outlet />
      </main>
    </>
  );
}
