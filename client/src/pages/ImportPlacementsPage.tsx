import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  ChevronLeft, Download, Upload, CheckCircle2, AlertTriangle, XCircle,
  FileSpreadsheet, Loader2, AlertCircle, X, Globe, Store,
} from 'lucide-react';
import {
  downloadImportTemplate, validateImportFile, commitImport,
  type ImportKind, type ImportRowResult, type ImportValidateResponse, type ImportCommitResponse,
} from '../api/index.js';
import Toast from '../components/Toast.js';
import ExportLangMenu, { type ExportLang } from '../components/ExportLangMenu.js';

const cardCls = 'bg-surface border border-hairline rounded-xl p-5';

function SectionHeader({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-2 mb-4">
      <div className="text-muted">{icon}</div>
      <h2 className="text-sm font-semibold text-ink tracking-tight">{title}</h2>
    </div>
  );
}

function rowDetail(r: ImportRowResult, kind: ImportKind) {
  const parts: string[] = [];
  if (r.raw.platform) parts.push(r.raw.platform);
  if (kind === 'online') {
    if (r.raw.model) parts.push(r.raw.model);
  } else if (r.raw.shopBranch) {
    parts.push(r.raw.shopBranch);
  }
  return parts.join(' · ');
}

export default function ImportPlacementsPage() {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [activeTab, setActiveTab] = useState<'new' | 'history'>('new');
  const [kind, setKind] = useState<ImportKind>('online');
  const [fileName, setFileName] = useState('');
  const [validating, setValidating] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [result, setResult] = useState<ImportValidateResponse | null>(null);
  const [commitResult, setCommitResult] = useState<ImportCommitResponse | null>(null);
  const [toast, setToast] = useState('');
  const [error, setError] = useState('');

  function handleReset() {
    setFileName('');
    setResult(null);
    setCommitResult(null);
    setError('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function handleKindChange(next: ImportKind) {
    if (next === kind) return;
    setKind(next);
    handleReset();
  }

  async function handleDownloadTemplate(lang: ExportLang) {
    try {
      await downloadImportTemplate(kind, lang);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('download.templateFailed'));
    }
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setError('');
    setResult(null);
    setCommitResult(null);
    setValidating(true);
    try {
      const res = await validateImportFile(file, kind);
      setResult(res);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('importPlacements.validateFailed'));
    } finally {
      setValidating(false);
    }
  }

  async function handleCommit() {
    if (!result) return;
    const validRows = result.rows.filter(r => r.errors.length === 0).map(r => ({ rowNumber: r.rowNumber, raw: r.raw }));
    if (validRows.length === 0) return;
    setError('');
    setCommitting(true);
    try {
      const res = await commitImport(kind, validRows);
      setCommitResult(res);
      setToast(t('importPlacements.commitSuccess', { count: res.created }));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('importPlacements.commitFailed'));
    } finally {
      setCommitting(false);
    }
  }

  const validRows = result?.rows.filter(r => r.errors.length === 0) ?? [];
  const errorRows = result?.rows.filter(r => r.errors.length > 0) ?? [];

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="mb-6">
        <Link to="/placements/new" className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink transition-colors mb-3">
          <ChevronLeft size={14} /> {t('importPlacements.back')}
        </Link>
        <h1 className="text-xl font-semibold text-ink tracking-tight">{t('importPlacements.title')}</h1>
        <p className="text-sm text-muted mt-0.5">{t('importPlacements.subtitle')}</p>
      </div>

      {toast && <Toast message={toast} onClose={() => setToast('')} />}
      {error && (
        <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 text-red-500 rounded-xl text-sm flex items-start gap-2">
          <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
          <span className="flex-1">{error}</span>
          <button onClick={() => setError('')} className="text-red-400 hover:text-red-600 transition-colors">
            <X size={13} />
          </button>
        </div>
      )}

      {/* Tab bar — 2 tabs */}
      <div className="flex items-center gap-1 bg-canvas rounded-lg p-1 mb-6 w-fit">
        {(
          [
            { id: 'new', label: t('importPlacements.tabNew') },
            { id: 'history', label: t('importPlacements.tabHistory') },
          ] as const
        ).map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-3.5 py-1.5 rounded-md text-sm font-medium transition-colors ${activeTab === tab.id ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink'}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'new' && (
      <div className="space-y-3">
        {/* Step 0 — choose online/offline template */}
        <div className={cardCls}>
          <SectionHeader icon={kind === 'online' ? <Globe size={15} /> : <Store size={15} />} title={t('importPlacements.selectTypeSection')} />
          <p className="text-sm text-muted mb-3">{t('importPlacements.selectTypeHint')}</p>
          <div className="flex gap-2">
            {(['online', 'offline'] as const).map(k => (
              <button key={k} type="button" onClick={() => handleKindChange(k)}
                className={`flex-1 py-2 rounded-full border text-sm font-medium transition-all active:scale-95 ${
                  kind === k
                    ? 'bg-accent text-white border-accent'
                    : 'bg-transparent text-ink border-hairline hover:border-accent/40 hover:text-accent'
                }`}
              >
                {k === 'online' ? 'Online' : t('importPlacements.offlineLabel')}
              </button>
            ))}
          </div>
        </div>

        {/* Step 1 */}
        <div className={cardCls}>
          <SectionHeader icon={<Download size={15} />} title={t('importPlacements.step1Title')} />
          <p className="text-sm text-muted mb-3">{t('importPlacements.step1HintStart')}<strong className="text-ink">{t('importPlacements.step1HintBold')}</strong>{t('importPlacements.step1HintEnd')}</p>
          <ExportLangMenu
            label={t('importPlacements.downloadTemplate', { kind: kind === 'online' ? 'Online' : 'Offline' })}
            onPick={handleDownloadTemplate}
          />
        </div>

        {/* Step 2 */}
        <div className={cardCls}>
          <SectionHeader icon={<Upload size={15} />} title={t('importPlacements.step2Title')} />
          <div className="flex items-center gap-3">
            <label className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-full active:scale-95 transition-all cursor-pointer bg-accent text-white hover:bg-accent-hover">
              <FileSpreadsheet size={14} />
              {t('importPlacements.chooseFile')}
              <input ref={fileInputRef} type="file" accept=".xlsx" className="hidden" onChange={handleFileChange} />
            </label>
            {fileName && <span className="text-sm text-muted truncate max-w-xs">{fileName}</span>}
            {validating && <Loader2 size={16} className="animate-spin text-accent" />}
          </div>
        </div>

        {/* Step 3 — preview */}
        {result && !commitResult && (
          <div className={cardCls}>
            <SectionHeader icon={<CheckCircle2 size={15} />} title={t('importPlacements.step3Title')} />

            <div className="mb-4 p-3 bg-canvas rounded-xl text-sm text-ink flex flex-wrap gap-x-4 gap-y-1">
              <span>{t('importPlacements.foundRows', { count: result.summary.total })}</span>
              <span className="text-green-600">{t('importPlacements.readyRows', { count: result.summary.valid })}</span>
              {result.summary.withErrors > 0 && (
                <span className="text-red-500">{t('importPlacements.errorRows', { count: result.summary.withErrors })}</span>
              )}
            </div>

            <div className="overflow-x-auto -mx-5 px-5">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted uppercase tracking-wide border-b border-hairline">
                    <th className="py-2 pr-3 font-medium">{t('importPlacements.colRow')}</th>
                    <th className="py-2 pr-3 font-medium">{t('importPlacements.colStatus')}</th>
                    <th className="py-2 pr-3 font-medium">{t('importPlacements.colBrand')}</th>
                    <th className="py-2 pr-3 font-medium">KOL Handle</th>
                    <th className="py-2 pr-3 font-medium">{t('importPlacements.colDetail')}</th>
                    <th className="py-2 pr-3 font-medium">Campaign</th>
                    <th className="py-2 font-medium">{t('importPlacements.colNotes')}</th>
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map(r => {
                    const hasError = r.errors.length > 0;
                    const hasWarning = r.warnings.length > 0;
                    return (
                      <tr key={r.rowNumber} className={`border-b border-hairline/50 ${hasError ? 'bg-red-500/5' : hasWarning ? 'bg-yellow-500/5' : ''}`}>
                        <td className="py-2 pr-3 text-muted">{r.rowNumber}</td>
                        <td className="py-2 pr-3">
                          {hasError ? (
                            <span className="inline-flex items-center gap-1 text-red-500"><XCircle size={13} /> {t('importPlacements.skip')}</span>
                          ) : hasWarning ? (
                            <span className="inline-flex items-center gap-1 text-yellow-600"><AlertTriangle size={13} /> {t('importPlacements.warning')}</span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-green-600"><CheckCircle2 size={13} /> {t('importPlacements.ready')}</span>
                          )}
                        </td>
                        <td className="py-2 pr-3 text-ink">{r.raw.brand || '—'}</td>
                        <td className="py-2 pr-3 text-ink">{r.raw.kolHandle || '—'}</td>
                        <td className="py-2 pr-3 text-muted">{rowDetail(r, kind) || '—'}</td>
                        <td className="py-2 pr-3 text-muted">{r.raw.campaign || '—'}</td>
                        <td className="py-2 text-xs">
                          {r.errors.map((e, i) => <div key={`e${i}`} className="text-red-500">{e}</div>)}
                          {r.warnings.map((w, i) => <div key={`w${i}`} className="text-yellow-600">{w}</div>)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex gap-2 pt-4">
              <button type="button" onClick={handleCommit} disabled={committing || validRows.length === 0}
                className="flex-1 py-3 bg-accent text-white font-medium rounded-full hover:bg-accent-hover disabled:opacity-50 active:scale-[0.99] transition-all text-sm">
                {committing ? t('common.saving') : t('importPlacements.commitButton', { count: validRows.length })}
              </button>
              <button type="button" onClick={handleReset}
                className="px-5 py-3 border border-hairline text-ink text-sm rounded-full hover:bg-canvas active:scale-95 transition-all">
                {t('importPlacements.restart')}
              </button>
            </div>
          </div>
        )}

        {/* Step 4 — commit summary */}
        {commitResult && (
          <div className={cardCls}>
            <SectionHeader icon={<CheckCircle2 size={15} />} title={t('importPlacements.commitSuccessTitle')} />
            <div className="space-y-1 text-sm text-ink mb-4">
              <p>{t('importPlacements.createdPlacements', { count: commitResult.created })}</p>
              {commitResult.branchesCreated > 0 && <p>{t('importPlacements.createdBranches', { count: commitResult.branchesCreated })}</p>}
              {commitResult.failed.length > 0 && (
                <div className="text-red-500 pt-2">
                  <p>{t('importPlacements.failedRows', { count: commitResult.failed.length })}</p>
                  {commitResult.failed.map(f => <p key={f.rowNumber} className="text-xs">{t('importPlacements.rowError', { row: f.rowNumber, error: f.error })}</p>)}
                </div>
              )}
              {errorRows.length > 0 && (
                <p className="text-muted pt-2">{t('importPlacements.skippedRowsNote', { count: errorRows.length })}</p>
              )}
            </div>
            <div className="flex gap-2">
              <Link to="/placements"
                className="flex-1 text-center py-3 bg-accent text-white font-medium rounded-full hover:bg-accent-hover active:scale-[0.99] transition-all text-sm">
                {t('importPlacements.goToPlacements')}
              </Link>
              <button type="button" onClick={handleReset}
                className="px-5 py-3 border border-hairline text-ink text-sm rounded-full hover:bg-canvas active:scale-95 transition-all">
                {t('importPlacements.importAnother')}
              </button>
            </div>
          </div>
        )}
      </div>
      )}

      {activeTab === 'history' && (
        <div className={cardCls}>
          <div className="text-center py-16">
            <p className="text-sm font-medium text-ink">{t('importPlacements.historyEmptyTitle')}</p>
          </div>
        </div>
      )}
    </div>
  );
}
