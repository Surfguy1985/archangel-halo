function escapeCell(value: unknown): string {
  if (value == null) return "";
  const s = String(value);
  if (/[",\n]/.test(s)) return`"${s.replace(/"/g, '""')}"`;
  return s;
}

export function exportCsv(
  filename: string,
  columns: { key: string; label: string}[],
  rows: Record<string, unknown>[],
): void {
  const header = columns.map((c) => escapeCell(c.label)).join(",");
  const body = rows
    .map((row) => columns.map((c) => escapeCell(row[c.key])).join(","))
    .join("\n");
  const csv =`${header}\n${body}`;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;"});
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
