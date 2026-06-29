import { useState } from 'react';
import { BarChart3, Table, Download } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import DataTable from './DataTable.js';
import { exportTableToExcel, type ExportColumn } from '../lib/exportTable.js';

interface Column {
  key: string;
  header: string;
  align?: 'left' | 'right' | 'center';
  width?: string;
  render?: (value: unknown, row: Record<string, unknown>) => React.ReactNode;
  exportFormat?: (value: unknown, row: Record<string, unknown>) => string | number;
}

interface Props {
  title: string;
  description?: string;
  chart: React.ReactNode;
  table: { columns: Column[]; rows: Record<string, unknown>[] };
  exportFilename: string;
  headerRight?: React.ReactNode;
  defaultView?: 'chart' | 'table';
  emptyMessage?: string;
}

export default function ChartTableCard({
  title, description, chart, table, exportFilename, headerRight, defaultView = 'chart', emptyMessage,
}: Props) {
  const { t } = useTranslation();
  const [view, setView] = useState<'chart' | 'table'>(defaultView);

  async function handleExport() {
    const cols: ExportColumn<Record<string, unknown>>[] = table.columns.map(c => ({
      key: c.key,
      header: c.header,
      format: c.exportFormat,
    }));
    await exportTableToExcel(cols, table.rows, exportFilename);
  }

  return (
    <div className="bg-surface border border-hairline rounded-xl p-5">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
          {description && <p className="text-[11px] text-muted mt-0.5">{description}</p>}
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
          {headerRight}
          <div className="flex items-center gap-1 bg-canvas rounded-lg p-1 shrink-0">
            <button
              title={t('dashboard.viewChart')}
              onClick={() => setView('chart')}
              className={`px-2 py-1 rounded-md transition-colors ${view === 'chart' ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink'}`}
            >
              <BarChart3 size={13} />
            </button>
            <button
              title={t('dashboard.viewTable')}
              onClick={() => setView('table')}
              className={`px-2 py-1 rounded-md transition-colors ${view === 'table' ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink'}`}
            >
              <Table size={13} />
            </button>
          </div>
          <button
            onClick={handleExport}
            title={t('dashboard.exportTable')}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium text-[#217346] bg-[#217346]/10 hover:bg-[#217346]/20 active:scale-95 transition-all shrink-0"
          >
            <Download size={12} /> Excel
          </button>
        </div>
      </div>
      {view === 'chart' ? chart : (
        <DataTable
          columns={table.columns}
          rows={table.rows}
          maxHeight={420}
          emptyMessage={emptyMessage}
        />
      )}
    </div>
  );
}
