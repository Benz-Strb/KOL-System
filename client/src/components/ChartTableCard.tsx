import { useState } from 'react';
import { BarChart3, Table } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import DataTable from './DataTable.js';
import { exportTableToExcel, type ExportColumn } from '../lib/exportTable.js';
import ExportLangMenu, { type ExportLang } from './ExportLangMenu.js';
import i18n from '../i18n/index.js';

interface Column {
  key: string;
  header?: string;
  headerKey?: string;
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
  /** Render without the outer card chrome (border/padding) so it can be embedded
   *  as a sub-section inside another card. Title renders as a smaller sub-header. */
  bare?: boolean;
}

export default function ChartTableCard({
  title, description, chart, table, exportFilename, headerRight, defaultView = 'chart', emptyMessage, bare = false,
}: Props) {
  const { t } = useTranslation();
  const [view, setView] = useState<'chart' | 'table'>(defaultView);

  async function handleExport(lang: ExportLang) {
    const tt = i18n.getFixedT(lang);
    const cols: ExportColumn<Record<string, unknown>>[] = table.columns.map(c => ({
      key: c.key,
      header: c.headerKey ? tt(c.headerKey) : (c.header ?? ''),
      format: c.exportFormat,
    }));
    await exportTableToExcel(cols, table.rows, exportFilename, {
      sheetName: tt('export.sheetName'),
      totalLabel: tt('export.totalRow'),
    });
  }

  const displayColumns = table.columns.map(c => ({
    ...c,
    header: c.headerKey ? t(c.headerKey) : (c.header ?? ''),
  }));

  const inner = (
    <>
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          {bare
            ? <h3 className="text-xs font-medium text-muted">{title}</h3>
            : <h2 className="text-sm font-semibold text-ink">{title}</h2>}
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
          <ExportLangMenu
            label="Excel"
            onPick={handleExport}
          />
        </div>
      </div>
      {view === 'chart' ? chart : (
        <DataTable
          columns={displayColumns}
          rows={table.rows}
          maxHeight={420}
          emptyMessage={emptyMessage}
        />
      )}
    </>
  );

  if (bare) return inner;
  return <div className="bg-surface border border-hairline rounded-xl p-5">{inner}</div>;
}
