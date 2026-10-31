import type { AccountResponse } from "@solvia/contracts";
import { Link } from "react-router";
import { ErrorAlert } from "../ui/error-alert.tsx";
import { ArchivedTag, ShowArchivedToggle, useShowArchived } from "../ui/show-archived.tsx";
import ui from "../ui/ui.module.css";
import { AccountBalance } from "./account-balance.tsx";
import { isLiability, useAccounts } from "./account-queries.ts";
import styles from "./accounts.module.css";
import { kindLabels, texts } from "./texts.ts";

export function AccountList() {
  const [includeArchived, setIncludeArchived] = useShowArchived();
  const accounts = useAccounts(includeArchived);

  return (
    <>
      <div className={ui.toolbar}>
        <h1>{texts.list.title}</h1>
        <ShowArchivedToggle checked={includeArchived} onChange={setIncludeArchived} />
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
    <section className={ui.section} aria-label={title}>
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
                    {account.archivedAt !== null && <ArchivedTag />}
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
