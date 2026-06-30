export interface ExportColumn<T> {
  key: keyof T & string;
  header: string;
  format?: (value: unknown, row: T) => string | number;
  width?: number;
  numFmt?: string;
}

export interface ExportOpts {
  sheetName?: string;
  totalLabel?: string;
}

export async function exportTableToExcel<T>(
  columns: ExportColumn<T>[],
  rows: T[],
  filename: string,
  opts?: ExportOpts,
): Promise<void> {
  const sheetName = opts?.sheetName ?? 'Data';
  const totalLabel = opts?.totalLabel ?? 'Total';

  const XLSX = await import('xlsx');
  const header = columns.map(c => c.header);
  const data = rows.map(row =>
    columns.map(c => {
      const val = (row as Record<string, unknown>)[c.key];
      return c.format ? c.format(val, row) : (val ?? '');
    }),
  );

  const ws = XLSX.utils.aoa_to_sheet([header, ...data]);

  // Column widths
  const colWidths = columns.map(col => ({ wch: col.width ?? 16 }));
  ws['!cols'] = colWidths;

  // AutoFilter on header row
  if (header.length > 0) {
    ws['!autofilter'] = { ref: `A1:${XLSX.utils.encode_col(columns.length - 1)}1` };
  }

  // Totals row (sum numeric columns)
  if (rows.length > 0) {
    const lastDataRow = rows.length + 1;
    const totalsRow: (string | { f: string })[] = columns.map((_col, ci) => {
      const colLetter = XLSX.utils.encode_col(ci);
      const isNumericCol = data.some(r => typeof r[ci] === 'number');
      if (isNumericCol) return { f: `SUM(${colLetter}2:${colLetter}${lastDataRow})` };
      if (ci === 0) return totalLabel;
      return '';
    });
    XLSX.utils.sheet_add_aoa(ws, [totalsRow], { origin: -1 });
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, filename);
}

export function todayStr() {
  return new Date().toISOString().slice(0, 10);
}
