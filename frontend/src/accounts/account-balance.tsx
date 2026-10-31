import type { AccountBalanceResponse } from "@solvia/contracts";
import { formatAmount } from "../format/amount.ts";
import { useAccountBalance } from "./account-queries.ts";
import styles from "./accounts.module.css";
import { texts } from "./texts.ts";

/** The balance derived by the server, with the overdraft position when the account has one. */
export function AccountBalance({ accountId }: { accountId: string }) {
  const balance = useAccountBalance(accountId);

  if (balance.isPending) {
    return <span>{texts.balance.loading}</span>;
  }
  if (balance.isError) {
    return <span>{texts.balance.unavailable}</span>;
  }
  return (
    <>
      <span>{formatAmount(balance.data.balance)}</span>
      <Overdraft overdraft={balance.data.overdraft} />
    </>
  );
}

function Overdraft({ overdraft }: { overdraft: AccountBalanceResponse["overdraft"] }) {
  if (overdraft === null) {
    return null;
  }
  // BR-22: the limit never blocks the ledger; going past it shows as `exceeded`.
  return (
    <>
      <span className={styles.overdraft}>
        {texts.balance.overdraftUsed(formatAmount(overdraft.used), formatAmount(overdraft.limit))}
      </span>
      <span className={styles.overdraft}>
        {texts.balance.available(formatAmount(overdraft.availableIncludingOverdraft))}
      </span>
      {overdraft.exceeded.amountMinor !== "0" && (
        <span className={styles.exceeded}>
          {texts.balance.overdraftExceeded(formatAmount(overdraft.exceeded))}
        </span>
      )}
    </>
  );
}
