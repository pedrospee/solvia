import { createAccountRequestSchema } from "@solvia/contracts";
import { Link, useNavigate } from "react-router";
import { ApiRequestError, callApi } from "../api/call-api.ts";
import { ErrorAlert } from "../ui/error-alert.tsx";
import { AccountForm, type AccountFormValues } from "./account-form.tsx";
import { useAccountMutation } from "./account-queries.ts";
import { texts } from "./texts.ts";

const EMPTY: AccountFormValues = {
  name: "",
  institution: "",
  kind: "BANK",
  currency: "EUR",
  overdraftLimit: null,
};

export function NewAccount() {
  const navigate = useNavigate();
  const create = useAccountMutation((api, values: AccountFormValues) => {
    // The contract's own schema checks the request's shape before it leaves (ADR-0005, D6).
    const request = createAccountRequestSchema.safeParse({
      name: values.name,
      kind: values.kind,
      currency: values.currency,
      ...(values.institution === "" ? {} : { institution: values.institution }),
      ...(values.overdraftLimit === null ? {} : { overdraftLimit: values.overdraftLimit }),
    });
    if (!request.success) {
      throw new ApiRequestError(400, "VALIDATION_FAILED", request.error.message);
    }
    return callApi(api.api.accounts.$post({ json: request.data }));
  });

  return (
    <>
      <h1>{texts.create.title}</h1>
      <ErrorAlert error={create.error} />
      <AccountForm
        initial={EMPTY}
        fixedKindAndCurrency={false}
        submitLabel={texts.create.submit}
        pendingLabel={texts.create.pending}
        pending={create.isPending}
        onSubmit={(values) => create.mutate(values, { onSuccess: () => navigate("/contas") })}
      >
        <Link to="/contas">{texts.create.cancel}</Link>
      </AccountForm>
    </>
  );
}
