import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  ChevronLeft, Download, Upload, CheckCircle2, AlertTriangle, XCircle,
  FileSpreadsheet, Loader2, AlertCircle, X, Globe, Store,
} from 'lucide-react';
import {
  downloadImportTemplate, validateImportFile, commitImport, listImportFiles, downloadImportFile, getAdminUsers,
  validatePerformanceFile, commitPerformanceImport,
  type ImportKind, type ImportRowResult, type ImportValidateResponse, type ImportCommitResponse,
  type ImportFileRow, type AdminUser,
  type PerformanceValidateResponse, type PerformanceCommitResponse, type PerformancePreviewRow, type PerformancePayload,
} from '../api/index.js';
import { useAuth } from '../context/AuthContext.js';
import { numberLocale } from '../i18n/locale.js';
import Toast from '../components/Toast.js';
import ExportLangMenu, { type ExportLang } from '../components/ExportLangMenu.js';
import ImportEditGrid from '../components/ImportEditGrid.js';
import Select from '../components/Select.js';

const cardCls = 'bg-surface border border-hairline rounded-xl p-5';

function SectionHeader({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-2 mb-4">
      <div className="text-muted">{icon}</div>
      <h2 className="text-sm font-semibold text-ink tracking-tight">{title}</h2>
    </div>
  );
}

export default function ImportPlacementsPage() {
  const { t } = useTranslation();
  const { appUser } = useAuth();
  const isAdmin = appUser?.role === 'admin';
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [activeTab, setActiveTab] = useState<'new' | 'history'>('new');
  // Reused by both the plan-import flow (below) and the Phase 7 performance-import
  // flow — a stored file is always single-kind, so the same toggle tells the
  // performance endpoint which `:kind` URL param to call (see Task 1 design note
  // server-side in placementsImport.ts).
  const [kind, setKind] = useState<ImportKind>('online');
  const [mode, setMode] = useState<'plan' | 'performance'>('plan');
  const [fileName, setFileName] = useState('');
  const [validating, setValidating] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [result, setResult] = useState<ImportValidateResponse | null>(null);
  // The grid owns the live, user-edited row state (raw + errors/warnings) once a file
  // has been validated — this is the source of truth for the summary counts and for
  // what gets sent to commitImport(), NOT the original result.rows snapshot.
  const [gridRows, setGridRows] = useState<ImportRowResult[]>([]);
  // Bumped once per successful validate — forces ImportEditGrid to remount (and reset
  // its internal edit state) when a brand new file is uploaded, instead of trying to
  // reconcile the previous file's edits with the newly uploaded rows.
  const [importGeneration, setImportGeneration] = useState(0);
  const [commitResult, setCommitResult] = useState<ImportCommitResponse | null>(null);
  const [toast, setToast] = useState('');
  const [error, setError] = useState('');

  // ─── "ประวัติไฟล์" (history) tab — Phase 6 ──────────────────────────
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [historyRows, setHistoryRows] = useState<ImportFileRow[]>([]);
  const [historyUserFilter, setHistoryUserFilter] = useState(''); // '' = everyone (admin only)
  const [adminUsers, setAdminUsers] = useState<AdminUser[]>([]);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  const historySeq = useRef(0);

  // Lazy-load the file list only once the user actually opens the history tab, and
  // re-fetch whenever the admin's "ผู้ใช้" filter changes — race guard (§9 CLAUDE.md)
  // since switching the filter quickly could otherwise let a stale response win.
  useEffect(() => {
    if (activeTab !== 'history') return;
    const mySeq = ++historySeq.current;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHistoryLoading(true);
    listImportFiles(isAdmin && historyUserFilter ? { userId: Number(historyUserFilter) } : {})
      .then(rows => {
        if (historySeq.current !== mySeq) return;
        setHistoryRows(rows);
        setHistoryLoaded(true);
      })
      .catch((err: unknown) => {
        if (historySeq.current !== mySeq) return;
        setError(err instanceof Error ? err.message : t('importPlacements.files.loadFailed'));
      })
      .finally(() => {
        if (historySeq.current !== mySeq) return;
        setHistoryLoading(false);
      });
  }, [activeTab, historyUserFilter, isAdmin, t]);

  // Admin-only user list for the filter dropdown — loaded lazily alongside the file
  // list itself (only ever needed once, so guard on the array already being filled).
  useEffect(() => {
    if (!isAdmin || activeTab !== 'history' || adminUsers.length > 0) return;
    getAdminUsers().then(setAdminUsers).catch(() => {});
  }, [isAdmin, activeTab, adminUsers.length]);

  async function handleDownloadFile(row: ImportFileRow) {
    setError('');
    setDownloadingId(row.id);
    try {
      await downloadImportFile(row.id, row.original_filename ?? undefined);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('download.failed'));
    } finally {
      setDownloadingId(null);
    }
  }

  function handleReset() {
    setFileName('');
    setResult(null);
    setGridRows([]);
    setCommitResult(null);
    setError('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function handleKindChange(next: ImportKind) {
    if (next === kind) return;
    setKind(next);
    handleReset();
    handlePerfReset();
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
    setGridRows([]);
    setCommitResult(null);
    setValidating(true);
    try {
      const res = await validateImportFile(file, kind);
      setResult(res);
      setGridRows(res.rows);
      setImportGeneration(g => g + 1);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('importPlacements.validateFailed'));
    } finally {
      setValidating(false);
    }
  }

  async function handleCommit() {
    if (gridRows.length === 0) return;
    const validRows = gridRows.filter(r => r.errors.length === 0).map(r => ({ rowNumber: r.rowNumber, raw: r.raw }));
    if (validRows.length === 0) return;
    setError('');
    setCommitting(true);
    try {
      const res = await commitImport(kind, validRows, fileName);
      setCommitResult(res);
      setToast(t('importPlacements.commitSuccess', { count: res.created }));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('importPlacements.commitFailed'));
    } finally {
      setCommitting(false);
    }
  }

  // ─── "กรอกผลงาน" (performance round-trip import) — Phase 7 ────────────
  // Deliberately a read-only preview + commit (no inline editable grid) — the
  // brief explicitly allows this for Phase 7 ("reuse editable-grid ได้ตามเหมาะ
  // (อย่างน้อย preview read-only + สถานะ) — inline edit ของ performance เป็น
  // nice-to-have").
  const perfFileInputRef = useRef<HTMLInputElement>(null);
  const [perfFileName, setPerfFileName] = useState('');
  const [perfValidating, setPerfValidating] = useState(false);
  const [perfCommitting, setPerfCommitting] = useState(false);
  const [perfResult, setPerfResult] = useState<PerformanceValidateResponse | null>(null);
  const [perfCommitResult, setPerfCommitResult] = useState<PerformanceCommitResponse | null>(null);

  function handlePerfReset() {
    setPerfFileName('');
    setPerfResult(null);
    setPerfCommitResult(null);
    if (perfFileInputRef.current) perfFileInputRef.current.value = '';
  }

  function handleModeChange(next: 'plan' | 'performance') {
    if (next === mode) return;
    setMode(next);
    setError('');
  }

  async function handlePerfFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPerfFileName(file.name);
    setError('');
    setPerfResult(null);
    setPerfCommitResult(null);
    setPerfValidating(true);
    try {
      const res = await validatePerformanceFile(file, kind);
      setPerfResult(res);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('importPlacements.performance.validateFailed'));
    } finally {
      setPerfValidating(false);
    }
  }

  async function handlePerfCommit() {
    if (!perfResult) return;
    const rows = perfResult.rows
      .filter((r): r is PerformancePreviewRow & { placement_id: number; willWrite: PerformancePayload } =>
        r.errors.length === 0 && r.placement_id != null && r.willWrite != null)
      .map(r => ({ placement_id: r.placement_id, payload: r.willWrite }));
    if (rows.length === 0) return;
    setError('');
    setPerfCommitting(true);
    try {
      const res = await commitPerformanceImport(rows);
      setPerfCommitResult(res);
      setToast(t('importPlacements.performance.commitSuccess', { count: res.updated }));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('importPlacements.performance.commitFailed'));
    } finally {
      setPerfCommitting(false);
    }
  }

  function perfRowStatus(row: PerformancePreviewRow): 'ready' | 'skip' | 'error' {
    if (row.errors.length > 0) return 'error';
    if (!row.willWrite) return 'skip';
    return 'ready';
  }

  // Short human-readable summary of what a row's willWrite payload contains —
  // domain words (channel names, GMV) stay in English per project convention.
  function summarizeWillWrite(w: PerformancePayload): string {
    const parts: string[] = [];
    if (w.publication_date) parts.push(w.publication_date);
    if (w.metrics && w.metrics.length > 0) parts.push(w.metrics.map(m => m.channel).join(', '));
    if (w.shopee_utm || w.lazada_utm || w.website_utm || w.ad_content_name || w.utm_campaign_name) parts.push('UTM');
    return parts.length > 0 ? parts.join(' · ') : t('importPlacements.performance.willWriteNone');
  }

  const perfRows = perfResult?.rows ?? [];
  const perfWillUpdateRows = perfRows.filter(r => perfRowStatus(r) === 'ready');
  const perfErrorRows = perfRows.filter(r => perfRowStatus(r) === 'error');
  const perfSkippedRows = perfRows.filter(r => perfRowStatus(r) === 'skip');

  // Live counts driven by the grid's current (possibly-edited) row state, not the
  // original upload snapshot — so fixing an error in the grid updates these too.
  const validRows = gridRows.filter(r => r.errors.length === 0);
  const errorRows = gridRows.filter(r => r.errors.length > 0);

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
        {/* Mode toggle — plan (existing flow) vs performance (Phase 7 round-trip) */}
        <div className="flex items-center gap-1 bg-canvas rounded-lg p-1 w-fit">
          {(
            [
              { id: 'plan', label: t('importPlacements.modePlan') },
              { id: 'performance', label: t('importPlacements.modePerformance') },
            ] as const
          ).map(m => (
            <button
              key={m.id}
              type="button"
              onClick={() => handleModeChange(m.id)}
              className={`px-3.5 py-1.5 rounded-md text-sm font-medium transition-colors ${mode === m.id ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink'}`}
            >
              {m.label}
            </button>
          ))}
        </div>

        {/* Step 0 — choose online/offline; shared between plan and performance modes
            (a stored file is always single-kind, see Task 1 server-side) */}
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

        {mode === 'plan' && (
        <>
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

        {/* Step 3 — preview + inline edit (Phase 4) */}
        {result && !commitResult && (
          <div className={cardCls}>
            <SectionHeader icon={<CheckCircle2 size={15} />} title={t('importPlacements.step3Title')} />

            <div className="mb-4 p-3 bg-canvas rounded-xl text-sm text-ink flex flex-wrap gap-x-4 gap-y-1">
              <span>{t('importPlacements.foundRows', { count: gridRows.length })}</span>
              <span className="text-green-600">{t('importPlacements.readyRows', { count: validRows.length })}</span>
              {errorRows.length > 0 && (
                <span className="text-red-500">{t('importPlacements.errorRows', { count: errorRows.length })}</span>
              )}
            </div>

            <ImportEditGrid
              key={importGeneration}
              rows={gridRows}
              lookups={result.lookups}
              kind={kind}
              onRowsChange={setGridRows}
            />

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
        </>
        )}

        {mode === 'performance' && (
        <>
        {/* Step 1 — performance files come from the history tab, not a fresh template */}
        <div className={cardCls}>
          <SectionHeader icon={<Download size={15} />} title={t('importPlacements.performance.step1Title')} />
          <p className="text-sm text-muted mb-3">{t('importPlacements.performance.step1Hint')}</p>
          <button type="button" onClick={() => setActiveTab('history')}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-full active:scale-95 transition-all border border-hairline text-ink hover:bg-canvas">
            {t('importPlacements.performance.goToHistoryButton')}
          </button>
        </div>

        {/* Step 2 */}
        <div className={cardCls}>
          <SectionHeader icon={<Upload size={15} />} title={t('importPlacements.performance.step2Title')} />
          <div className="flex items-center gap-3">
            <label className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-full active:scale-95 transition-all cursor-pointer bg-accent text-white hover:bg-accent-hover">
              <FileSpreadsheet size={14} />
              {t('importPlacements.chooseFile')}
              <input ref={perfFileInputRef} type="file" accept=".xlsx" className="hidden" onChange={handlePerfFileChange} />
            </label>
            {perfFileName && <span className="text-sm text-muted truncate max-w-xs">{perfFileName}</span>}
            {perfValidating && <Loader2 size={16} className="animate-spin text-accent" />}
          </div>
        </div>

        {/* Step 3 — read-only preview + commit */}
        {perfResult && !perfCommitResult && (
          <div className={cardCls}>
            <SectionHeader icon={<CheckCircle2 size={15} />} title={t('importPlacements.performance.step3Title')} />

            <div className="mb-4 p-3 bg-canvas rounded-xl text-sm text-ink flex flex-wrap gap-x-4 gap-y-1">
              <span>{t('importPlacements.performance.foundRows', { count: perfRows.length })}</span>
              <span className="text-green-600">{t('importPlacements.performance.willUpdateRows', { count: perfWillUpdateRows.length })}</span>
              {perfSkippedRows.length > 0 && (
                <span className="text-yellow-600">{t('importPlacements.performance.skippedRows', { count: perfSkippedRows.length })}</span>
              )}
              {perfErrorRows.length > 0 && (
                <span className="text-red-500">{t('importPlacements.performance.errorRows', { count: perfErrorRows.length })}</span>
              )}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-hairline">
                    <th className="px-3 py-2.5 text-left text-xs font-medium text-muted uppercase tracking-wider">{t('importPlacements.performance.colRow')}</th>
                    <th className="px-3 py-2.5 text-left text-xs font-medium text-muted uppercase tracking-wider">{t('importPlacements.performance.colStatus')}</th>
                    <th className="px-3 py-2.5 text-left text-xs font-medium text-muted uppercase tracking-wider">{t('importPlacements.performance.colPlacementId')}</th>
                    <th className="px-3 py-2.5 text-left text-xs font-medium text-muted uppercase tracking-wider">{t('importPlacements.performance.colBrand')}</th>
                    <th className="px-3 py-2.5 text-left text-xs font-medium text-muted uppercase tracking-wider">{t('importPlacements.performance.colKol')}</th>
                    <th className="px-3 py-2.5 text-left text-xs font-medium text-muted uppercase tracking-wider">{t('importPlacements.performance.colModel')}</th>
                    <th className="px-3 py-2.5 text-left text-xs font-medium text-muted uppercase tracking-wider">{t('importPlacements.performance.colWillWrite')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-hairline">
                  {perfRows.map(row => {
                    const status = perfRowStatus(row);
                    const tint = status === 'error' ? 'bg-red-500/5' : status === 'skip' ? 'bg-yellow-500/5' : '';
                    return (
                      <tr key={row.rowNumber} className={tint}>
                        <td className="px-3 py-3 text-muted tabular-nums font-mono">{row.rowNumber}</td>
                        <td className="px-3 py-3">
                          {status === 'error' && <span className="inline-flex items-center gap-1 text-red-500"><XCircle size={13} /> {t('importPlacements.skip')}</span>}
                          {status === 'skip' && <span className="inline-flex items-center gap-1 text-yellow-600"><AlertTriangle size={13} /> {t('importPlacements.performance.rowSkipNoData')}</span>}
                          {status === 'ready' && <span className="inline-flex items-center gap-1 text-green-600"><CheckCircle2 size={13} /> {t('importPlacements.ready')}</span>}
                        </td>
                        <td className="px-3 py-3 text-ink tabular-nums font-mono">{row.placement_id ?? '—'}</td>
                        <td className="px-3 py-3 text-muted">{row.brand ?? '—'}</td>
                        <td className="px-3 py-3 text-ink">{row.kolHandle ?? '—'}</td>
                        <td className="px-3 py-3 text-muted">{row.model ?? '—'}</td>
                        <td className="px-3 py-3 text-muted">
                          {row.willWrite ? summarizeWillWrite(row.willWrite) : t('importPlacements.performance.willWriteNone')}
                          {(row.errors.length > 0 || row.warnings.length > 0) && (
                            <div className="mt-1 space-y-0.5 text-xs">
                              {row.errors.map((e, i) => <div key={`e${i}`} className="text-red-500">{e}</div>)}
                              {row.warnings.map((w, i) => <div key={`w${i}`} className="text-yellow-600">{w}</div>)}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex gap-2 pt-4">
              <button type="button" onClick={handlePerfCommit} disabled={perfCommitting || perfWillUpdateRows.length === 0}
                className="flex-1 py-3 bg-accent text-white font-medium rounded-full hover:bg-accent-hover disabled:opacity-50 active:scale-[0.99] transition-all text-sm">
                {perfCommitting ? t('common.saving') : t('importPlacements.performance.commitButton', { count: perfWillUpdateRows.length })}
              </button>
              <button type="button" onClick={handlePerfReset}
                className="px-5 py-3 border border-hairline text-ink text-sm rounded-full hover:bg-canvas active:scale-95 transition-all">
                {t('importPlacements.restart')}
              </button>
            </div>
          </div>
        )}

        {/* Step 4 — commit summary */}
        {perfCommitResult && (
          <div className={cardCls}>
            <SectionHeader icon={<CheckCircle2 size={15} />} title={t('importPlacements.performance.commitSuccessTitle')} />
            <div className="space-y-1 text-sm text-ink mb-4">
              <p>{t('importPlacements.performance.updatedCount', { count: perfCommitResult.updated })}</p>
              {perfCommitResult.failed.length > 0 && (
                <div className="text-red-500 pt-2">
                  <p>{t('importPlacements.performance.failedRows', { count: perfCommitResult.failed.length })}</p>
                  {perfCommitResult.failed.map((f, i) => (
                    <p key={i} className="text-xs">{t('importPlacements.performance.rowError', { id: f.placement_id ?? '—', error: f.error })}</p>
                  ))}
                </div>
              )}
            </div>
            <div className="flex gap-2">
              <Link to="/placements"
                className="flex-1 text-center py-3 bg-accent text-white font-medium rounded-full hover:bg-accent-hover active:scale-[0.99] transition-all text-sm">
                {t('importPlacements.goToPlacements')}
              </Link>
              <button type="button" onClick={handlePerfReset}
                className="px-5 py-3 border border-hairline text-ink text-sm rounded-full hover:bg-canvas active:scale-95 transition-all">
                {t('importPlacements.importAnother')}
              </button>
            </div>
          </div>
        )}
        </>
        )}
      </div>
      )}

      {activeTab === 'history' && (
        <div className={cardCls}>
          {isAdmin && (
            <div className="mb-4 flex items-center gap-2">
              <span className="text-sm text-muted shrink-0">{t('importPlacements.files.userFilterLabel')}</span>
              <Select
                size="sm"
                className="w-60"
                value={historyUserFilter}
                onChange={setHistoryUserFilter}
                placeholder={t('importPlacements.files.userFilterAll')}
                options={[
                  { id: '', label: t('importPlacements.files.userFilterAll') },
                  ...adminUsers.map(u => ({ id: u.id, label: u.full_name })),
                ]}
              />
            </div>
          )}

          {historyLoading && (
            <div className="py-16 text-center">
              <Loader2 size={20} className="animate-spin text-accent inline-block" />
            </div>
          )}

          {!historyLoading && historyLoaded && historyRows.length === 0 && (
            <div className="text-center py-16">
              <p className="text-sm font-medium text-ink">
                {historyUserFilter ? t('importPlacements.files.noResultsFiltered') : t('importPlacements.historyEmptyTitle')}
              </p>
            </div>
          )}

          {!historyLoading && historyRows.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-hairline">
                    <th className="px-3 py-2.5 text-left text-xs font-medium text-muted uppercase tracking-wider">{t('importPlacements.files.colFilename')}</th>
                    <th className="px-3 py-2.5 text-left text-xs font-medium text-muted uppercase tracking-wider">{t('importPlacements.files.colType')}</th>
                    <th className="px-3 py-2.5 text-right text-xs font-medium text-muted uppercase tracking-wider">{t('importPlacements.files.colCount')}</th>
                    <th className="px-3 py-2.5 text-left text-xs font-medium text-muted uppercase tracking-wider">{t('importPlacements.files.colBrand')}</th>
                    <th className="px-3 py-2.5 text-left text-xs font-medium text-muted uppercase tracking-wider">{t('importPlacements.files.colDate')}</th>
                    {isAdmin && <th className="px-3 py-2.5 text-left text-xs font-medium text-muted uppercase tracking-wider">{t('importPlacements.files.colCreator')}</th>}
                    <th className="px-3 py-2.5 text-right text-xs font-medium text-muted uppercase tracking-wider">{t('importPlacements.files.colDownload')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-hairline">
                  {historyRows.map(row => (
                    <tr key={row.id} className="hover:bg-canvas transition-colors">
                      <td className="px-3 py-3 text-ink text-sm truncate max-w-xs">{row.original_filename ?? '—'}</td>
                      <td className="px-3 py-3 text-sm text-muted">{row.kind === 'online' ? 'Online' : t('importPlacements.offlineLabel')}</td>
                      <td className="px-3 py-3 text-right text-sm tabular-nums font-mono text-muted">{row.placement_count}</td>
                      <td className="px-3 py-3 text-sm text-muted">{row.brand_summary ?? '—'}</td>
                      <td className="px-3 py-3 text-sm text-muted whitespace-nowrap">{new Date(row.created_at).toLocaleDateString(numberLocale())}</td>
                      {isAdmin && <td className="px-3 py-3 text-sm text-muted">{row.user.name}</td>}
                      <td className="px-3 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => handleDownloadFile(row)}
                          disabled={downloadingId === row.id}
                          aria-label={t('importPlacements.files.downloadAria', { filename: row.original_filename ?? '' })}
                          className="inline-flex items-center justify-center w-8 h-8 rounded-full border border-hairline text-ink hover:bg-canvas active:scale-95 disabled:opacity-50 transition-all"
                        >
                          {downloadingId === row.id ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
