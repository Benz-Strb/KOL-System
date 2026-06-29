import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface Props {
  page: number;
  pages: number;
  total: number;
  pageSize: number;
  onPage: (p: number) => void;
}

export default function Paginator({ page, pages, total, pageSize, onPage }: Props) {
  const { t } = useTranslation();
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 pt-3 mt-2 border-t border-hairline text-xs">
      <span className="text-muted">
        {t('dashboard.paginatorShowing', { from, to, total })}
      </span>
      <div className="flex items-center gap-1">
        <button
          onClick={() => onPage(page - 1)}
          disabled={page <= 1}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-muted hover:text-ink hover:bg-canvas disabled:opacity-40 disabled:hover:bg-transparent transition-colors"
        >
          <ChevronLeft size={13} />
          {t('dashboard.paginatorPrev')}
        </button>
        <span className="text-muted tabular-nums px-1">
          {t('dashboard.paginatorPage', { page, pages: pages || 1 })}
        </span>
        <button
          onClick={() => onPage(page + 1)}
          disabled={page >= pages}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-muted hover:text-ink hover:bg-canvas disabled:opacity-40 disabled:hover:bg-transparent transition-colors"
        >
          {t('dashboard.paginatorNext')}
          <ChevronRight size={13} />
        </button>
      </div>
    </div>
  );
}
