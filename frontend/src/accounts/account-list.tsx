import type { AccountResponse } from "@solvia/contracts";
import { Link, useSearchParams } from "react-router";
import { ErrorAlert } from "../ui/error-alert.tsx";
import ui from "../ui/ui.module.css";
import { AccountBalance } from "./account-balance.tsx";
import { isLiability, useAccounts } from "./account-queries.ts";
import styles from "./accounts.module.css";
import { kindLabels, texts } from "./texts.ts";

// ?arquivadas=1 keeps the choice in the URL, so a reload or the back button keeps it.
const SHOW_ARCHIVED = "arquivadas";

export function AccountList() {
  const [searchParams, setSearchParams] = useSearchParams();
  const includeArchived = searchParams.get(SHOW_ARCHIVED) === "1";
  const accounts = useAccounts(includeArchived);

  function toggleArchived(show: boolean) {
    setSearchParams(show ? { [SHOW_ARCHIVED]: "1" } : {}, { replace: true });
  }

  return (
    <>
      <div className={styles.toolbar}>
        <h1>{texts.list.title}</h1>
        <label className={styles.checkbox}>
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={(event) => toggleArchived(event.target.checked)}
          />
          {texts.list.showArchived}
        </label>
        <Link to="/contas/nova" className={ui.button}>
          {texts.list.newAccount}
        </Link>
      </div>
      {accounts.isPending && <p role="status">{texts.list.loading}</p>}
      <ErrorAlert error={accounts.error} />
      {accounts.isSuccess &&
        (accounts.data.items.length === 0 ? (
          <p>{texts.list.empty}</p>
        ) : (
          <>
            <AccountGroup
              title={texts.list.assets}
              amountTitle={texts.list.columns.balance}
              accounts={accounts.data.items.filter((account) => !isLiability(account.kind))}
            />
            <AccountGroup
              title={texts.list.liabilities}
              amountTitle={texts.list.columns.owed}
              accounts={accounts.data.items.filter((account) => isLiability(account.kind))}
            />
          </>
        ))}
    </>
  );
}

function AccountGroup({
  title,
  amountTitle,
  accounts,
}: {
  title: string;
  amountTitle: string;
  accounts: AccountResponse[];
}) {
  return (
    <section className={styles.section} aria-label={title}>
      <h2>{title}</h2>
      {accounts.length === 0 ? (
        <p className={ui.notice}>{texts.list.emptyGroup}</p>
      ) : (
        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">{texts.list.columns.name}</th>
                <th scope="col" className={styles.wide}>
                  {texts.list.columns.institution}
                </th>
                <th scope="col">{texts.list.columns.kind}</th>
                <th scope="col" className={styles.wide}>
                  {texts.list.columns.currency}
                </th>
                <th scope="col" className={styles.amount}>
                  {amountTitle}
                </th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((account) => (
                <tr key={account.id}>
                  <td>
                    <Link to={`/contas/${account.id}`}>{account.name}</Link>
                    {account.archivedAt !== null && (
                      <span className={styles.tag}>{texts.list.archived}</span>
                    )}
                  </td>
                  <td className={styles.wide}>{account.institution ?? ""}</td>
                  <td>{kindLabels[account.kind]}</td>
                  <td className={styles.wide}>{account.currency}</td>
                  <td className={styles.amount}>
                    <AccountBalance accountId={account.id} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
