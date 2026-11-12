/**
 * Today's date in Poland as an `ExecutionDate` value (`yyyy-MM-ddT00:00:00`, no offset).
 * The API compares ExecutionDate with its own date in Poland (Europe/Warsaw) and rejects earlier days, so use
 * the Warsaw date, not your local date and not `toISOString()` (UTC).
 */
export function executionDateToday(now: Date = new Date()): string {
  return `${new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Warsaw" }).format(now)}T00:00:00`;
}
