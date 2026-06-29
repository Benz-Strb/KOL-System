export interface ExportColumn<T> {
  key: keyof T & string;
  header: string;
  format?: (value: unknown, row: T) => string | number;
}

export async function exportTableToExcel<T>(
  columns: ExportColumn<T>[],
  rows: T[],
  filename: string,
  sheetName = 'Sheet1',
): Promise<void> {
  const XLSX = await import('xlsx');
  const header = columns.map(c => c.header);
  const data = rows.map(row =>
    columns.map(c => {
      const val = (row as Record<string, unknown>)[c.key];
      return c.format ? c.format(val, row) : (val ?? '');
    }),
  );
  const ws = XLSX.utils.aoa_to_sheet([header, ...data]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, filename);
}

export function todayStr() {
  return new Date().toISOString().slice(0, 10);
}
