import { type AccountResponse, updateAccountRequestSchema } from "@solvia/contracts";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ApiRequestError, callApi } from "../api/call-api.ts";
import { formatTimestampDate } from "../format/date.ts";
import { ErrorAlert } from "../ui/error-alert.tsx";
import ui from "../ui/ui.module.css";
import { AccountBalance } from "./account-balance.tsx";
import { AccountForm, type AccountFormValues } from "./account-form.tsx";
import { isLiability, useAccount, useAccountMutation } from "./account-queries.ts";
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
  const update = useAccountMutation((api, values: AccountFormValues) => {
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

      <section className={styles.section}>
        <h2>{isLiability(account.kind) ? texts.details.owedTitle : texts.details.balanceTitle}</h2>
        <div className={styles.summary}>
          <AccountBalance accountId={account.id} />
        </div>
      </section>

      <section className={styles.section}>
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
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const archived = account.archivedAt !== null;

  const toggleArchive = useAccountMutation((api) => {
    const param = { param: { id: account.id } };
    return callApi(
      archived
        ? api.api.accounts[":id"].unarchive.$post(param)
        : api.api.accounts[":id"].archive.$post(param),
    );
  });
  const remove = useAccountMutation((api) =>
    callApi(api.api.accounts[":id"].$delete({ param: { id: account.id } })),
  );

  return (
    <section className={styles.section}>
      <h2>{texts.details.lifecycleTitle}</h2>
      <p className={ui.notice}>{texts.details.archiveHint}</p>
      <ErrorAlert error={toggleArchive.error ?? remove.error} />
      <div className={styles.actions}>
        <button
          type="button"
          className={ui.secondary}
          disabled={toggleArchive.isPending}
          onClick={() => toggleArchive.mutate(undefined)}
        >
          {archived ? texts.details.unarchive : texts.details.archive}
        </button>
        {confirmingDelete ? (
          <>
            <span>{texts.details.deleteQuestion}</span>
            <button
              type="button"
              className={ui.danger}
              disabled={remove.isPending}
              onClick={() =>
                remove.mutate(undefined, {
                  onSuccess: () => navigate("/contas"),
                  onError: () => setConfirmingDelete(false),
                })
              }
            >
              {texts.details.deleteConfirm}
            </button>
            <button
              type="button"
              className={ui.secondary}
              onClick={() => setConfirmingDelete(false)}
            >
              {texts.details.deleteCancel}
            </button>
          </>
        ) : (
          <button type="button" className={ui.danger} onClick={() => setConfirmingDelete(true)}>
            {texts.details.delete}
          </button>
        )}
      </div>
    </section>
  );
}
