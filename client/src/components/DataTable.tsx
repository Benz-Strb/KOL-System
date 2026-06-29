interface Column {
  key: string;
  header: string;
  align?: 'left' | 'right' | 'center';
  width?: string;
  render?: (value: unknown, row: Record<string, unknown>) => React.ReactNode;
}

interface Props {
  columns: Column[];
  rows: Record<string, unknown>[];
  maxHeight?: number;
  emptyMessage?: string;
}

export default function DataTable({ columns, rows, maxHeight, emptyMessage = 'ไม่มีข้อมูล' }: Props) {
  const thAlign = (align?: string) =>
    align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left';
  const tdAlign = (align?: string) =>
    align === 'right' ? 'text-right tabular-nums font-mono' : align === 'center' ? 'text-center' : '';

  return (
    <div className="overflow-x-auto -mx-1 px-1">
      <div style={maxHeight ? { maxHeight, overflowY: 'auto' } : undefined}>
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-surface z-10">
            <tr className="text-muted border-b border-hairline">
              {columns.map(col => (
                <th
                  key={col.key}
                  style={col.width ? { width: col.width } : undefined}
                  className={`font-medium py-2 pr-2 first:pl-0 ${thAlign(col.align)}`}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="py-6 text-center text-sm text-muted">
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              rows.map((row, i) => (
                <tr key={i} className="border-b border-hairline last:border-0 hover:bg-canvas transition-colors">
                  {columns.map(col => (
                    <td
                      key={col.key}
                      className={`py-2.5 pr-2 first:pl-0 text-ink ${tdAlign(col.align)}`}
                    >
                      {col.render
                        ? col.render(row[col.key], row)
                        : (row[col.key] as React.ReactNode ?? '—')}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
