import {
  type AccountKindJson,
  accountKindSchema,
  type CurrencyJson,
  currencySchema,
  type MoneyJson,
} from "@solvia/contracts";
import { type FormEvent, type ReactNode, useState } from "react";
import { parseAmountInput, toAmountInput } from "../format/amount.ts";
import { Field } from "../ui/field.tsx";
import ui from "../ui/ui.module.css";
import styles from "./accounts.module.css";
import { currencyLabels, kindLabels, texts } from "./texts.ts";

/** What the form gives back: trimmed text, and the limit only for a bank account. */
export type AccountFormValues = {
  name: string;
  institution: string;
  kind: AccountKindJson;
  currency: CurrencyJson;
  overdraftLimit: MoneyJson | null;
};

type Errors = Partial<Record<"name" | "overdraftLimit", string>>;

/**
 * The fields of an account. Only the form of the input is checked here (a name, an amount
 * that reads as one); every financial rule is the server's, and its answer is shown by the
 * page (ADR-0005, D6). Kind and currency can be chosen only when creating.
 */
export function AccountForm({
  initial,
  fixedKindAndCurrency,
  submitLabel,
  pendingLabel,
  pending,
  onSubmit,
  children,
}: {
  initial: AccountFormValues;
  fixedKindAndCurrency: boolean;
  submitLabel: string;
  pendingLabel: string;
  pending: boolean;
  onSubmit: (values: AccountFormValues) => void;
  children?: ReactNode;
}) {
  const [name, setName] = useState(initial.name);
  const [institution, setInstitution] = useState(initial.institution);
  const [kind, setKind] = useState(initial.kind);
  const [currency, setCurrency] = useState(initial.currency);
  const [limit, setLimit] = useState(
    initial.overdraftLimit === null ? "" : toAmountInput(initial.overdraftLimit),
  );
  const [errors, setErrors] = useState<Errors>({});

  // BR-22: only bank accounts may have an overdraft limit.
  const hasOverdraft = kind === "BANK";

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors: Errors = {};
    if (name.trim() === "") {
      nextErrors.name = texts.form.nameRequired;
    }

    let overdraftLimit: MoneyJson | null = null;
    if (hasOverdraft && limit.trim() !== "") {
      const parsed = parseAmountInput(limit, currency);
      if (parsed.ok) {
        overdraftLimit = parsed.money;
      } else {
        nextErrors.overdraftLimit =
          parsed.reason === "TOO_MANY_DECIMALS"
            ? texts.form.amountTooManyDecimals
            : texts.form.amountInvalid;
      }
    }

    setErrors(nextErrors);
    if (Object.keys(nextErrors).length === 0) {
      onSubmit({
        name: name.trim(),
        institution: institution.trim(),
        kind,
        currency,
        overdraftLimit,
      });
    }
  }

  return (
    <form className={styles.form} onSubmit={submit} noValidate>
      <Field label={texts.form.name} error={errors.name}>
        {(control) => (
          <input {...control} value={name} onChange={(event) => setName(event.target.value)} />
        )}
      </Field>
      <Field label={texts.form.institution}>
        {(control) => (
          <input
            {...control}
            value={institution}
            onChange={(event) => setInstitution(event.target.value)}
          />
        )}
      </Field>
      <Field
        label={texts.form.kind}
        hint={fixedKindAndCurrency ? texts.form.fixedKindAndCurrency : undefined}
      >
        {(control) => (
          <select
            {...control}
            value={kind}
            disabled={fixedKindAndCurrency}
            onChange={(event) => setKind(accountKindSchema.parse(event.target.value))}
          >
            {accountKindSchema.options.map((option) => (
              <option key={option} value={option}>
                {kindLabels[option]}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label={texts.form.currency}>
        {(control) => (
          <select
            {...control}
            value={currency}
            disabled={fixedKindAndCurrency}
            onChange={(event) => setCurrency(currencySchema.parse(event.target.value))}
          >
            {currencySchema.options.map((option) => (
              <option key={option} value={option}>
                {currencyLabels[option]}
              </option>
            ))}
          </select>
        )}
      </Field>
      {hasOverdraft && (
        <Field
          label={texts.form.overdraftLimit}
          hint={texts.form.overdraftHint}
          error={errors.overdraftLimit}
        >
          {(control) => (
            <input
              {...control}
              value={limit}
              inputMode="decimal"
              onChange={(event) => setLimit(event.target.value)}
            />
          )}
        </Field>
      )}
      <div className={styles.actions}>
        <button type="submit" className={ui.button} disabled={pending}>
          {pending ? pendingLabel : submitLabel}
        </button>
        {children}
      </div>
    </form>
  );
}
