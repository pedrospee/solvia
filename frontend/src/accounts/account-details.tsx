import { type AccountResponse, updateAccountRequestSchema } from "@solvia/contracts";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ApiRequestError, callApi } from "../api/call-api.ts";
import { useApiMutation } from "../api/use-api-mutation.ts";
import { formatTimestampDate } from "../format/date.ts";
import { ErrorAlert } from "../ui/error-alert.tsx";
import { LifecycleSection } from "../ui/lifecycle-section.tsx";
import ui from "../ui/ui.module.css";
import { AccountBalance } from "./account-balance.tsx";
import { AccountForm, type AccountFormValues } from "./account-form.tsx";
import { accountKeys, isLiability, useAccount } from "./account-queries.ts";
import styles from "./accounts.module.css";
import { kindLabels, texts } from "./texts.ts";

export function AccountDetails() {
  const { id = "" } = useParams();
  const account = useAccount(id);

  return (
    <>
      <p>
        <Link to="/contas">{texts.details.back}</Link>
      </p>
      {account.isPending && <p role="status">{texts.details.loading}</p>}
      <ErrorAlert error={account.error} />
      {account.isSuccess && <AccountPage account={account.data} />}
    </>
  );
}

function AccountPage({ account }: { account: AccountResponse }) {
  const [saved, setSaved] = useState(false);
  const update = useApiMutation(accountKeys.all, (api, values: AccountFormValues) => {
    const request = updateAccountRequestSchema.safeParse({
      name: values.name,
      institution: values.institution === "" ? null : values.institution,
      // Only bank accounts have a limit (BR-22): another kind sends none, so none changes.
      ...(account.kind === "BANK" ? { overdraftLimit: values.overdraftLimit } : {}),
    });
    if (!request.success) {
      throw new ApiRequestError(400, "VALIDATION_FAILED", request.error.message);
    }
    return callApi(
      api.api.accounts[":id"].$patch({ param: { id: account.id }, json: request.data }),
    );
  });

  return (
    <>
      <h1>{account.name}</h1>
      <p className={ui.notice}>
        {kindLabels[account.kind]} · {account.currency}
        {account.institution !== null && ` · ${account.institution}`}
      </p>
      {account.archivedAt !== null && (
        <p role="note">{texts.details.archivedOn(formatTimestampDate(account.archivedAt))}</p>
      )}

      <section className={ui.section}>
        <h2>{isLiability(account.kind) ? texts.details.owedTitle : texts.details.balanceTitle}</h2>
        <div className={styles.summary}>
          <AccountBalance accountId={account.id} />
        </div>
      </section>

      <section className={ui.section}>
        <h2>{texts.details.editTitle}</h2>
        <ErrorAlert error={update.error} />
        {saved && <p role="status">{texts.details.saved}</p>}
        <AccountForm
          // Keyed by the last change, so the form starts again from what the server saved.
          key={account.updatedAt}
          initial={{
            name: account.name,
            institution: account.institution ?? "",
            kind: account.kind,
            currency: account.currency,
            overdraftLimit: account.overdraftLimit,
          }}
          fixedKindAndCurrency
          submitLabel={texts.details.save}
          pendingLabel={texts.details.saving}
          pending={update.isPending}
          onSubmit={(values) => {
            setSaved(false);
            update.mutate(values, { onSuccess: () => setSaved(true) });
          }}
        />
      </section>

      <Lifecycle account={account} />
    </>
  );
}

function Lifecycle({ account }: { account: AccountResponse }) {
  const navigate = useNavigate();
  const archived = account.archivedAt !== null;
  const param = { param: { id: account.id } };
  const toggleArchive = useApiMutation(accountKeys.all, (api) =>
    callApi(
      archived
        ? api.api.accounts[":id"].unarchive.$post(param)
        : api.api.accounts[":id"].archive.$post(param),
    ),
  );
  const remove = useApiMutation(accountKeys.all, (api) =>
    callApi(api.api.accounts[":id"].$delete(param)),
  );

  return (
    <LifecycleSection
      archived={archived}
      toggleArchive={toggleArchive}
      remove={remove}
      onDeleted={() => navigate("/contas")}
      texts={texts.lifecycle}
    />
  );
}
