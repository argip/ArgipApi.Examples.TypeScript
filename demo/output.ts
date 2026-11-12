/** Prints any value as indented JSON. */
export function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

export interface Column<T> {
  header: string;
  value: (row: T) => unknown;
}

/** Prints rows as a plain-text table: columns as wide as their longest cell, numbers aligned to the right. */
export function printTable<T>(rows: T[], columns: Column<T>[]): void {
  const cells = rows.map((row) => columns.map((column) => String(column.value(row) ?? "")));
  const numeric = columns.map((column) => rows.length > 0 && rows.every((row) => typeof column.value(row) === "number"));
  const widths = columns.map((column, i) => Math.max(column.header.length, ...cells.map((line) => line[i]!.length)));
  const format = (line: string[]) =>
    line.map((cell, i) => (numeric[i] ? cell.padStart(widths[i]!) : cell.padEnd(widths[i]!))).join("  ").trimEnd();

  console.log(format(columns.map((column) => column.header)));
  for (const line of cells) console.log(format(line));
}
