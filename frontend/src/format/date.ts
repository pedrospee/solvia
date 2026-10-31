const DATE = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" });

/** An API timestamp as a pt-BR date in the user's time zone: "31/10/2026". */
export function formatTimestampDate(timestamp: string): string {
  return DATE.format(new Date(timestamp));
}
