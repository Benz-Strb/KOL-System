import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ChevronLeft, Download, Upload, CheckCircle2, AlertTriangle, XCircle,
  FileSpreadsheet, Loader2, AlertCircle, X, Globe, Store, Tag,
} from 'lucide-react';
import {
  getDropdowns, downloadImportTemplate, validateImportFile, commitImport,
  type Brand, type ImportKind, type ImportRowResult, type ImportValidateResponse, type ImportCommitResponse,
} from '../api/index.js';
import Toast from '../components/Toast.js';
import Select from '../components/Select.js';

const cardCls = 'bg-surface border border-hairline rounded-2xl p-5';

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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [brandId, setBrandId] = useState('');
  const [kind, setKind] = useState<ImportKind>('online');
  const [fileName, setFileName] = useState('');
  const [validating, setValidating] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [result, setResult] = useState<ImportValidateResponse | null>(null);
  const [commitResult, setCommitResult] = useState<ImportCommitResponse | null>(null);
  const [toast, setToast] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    getDropdowns().then(d => {
      setBrands(d.brands);
      // Auto-select brand if user has exactly one — เลือกแบรนด์เองเฉพาะคนที่เข้าถึงได้หลายแบรนด์
      if (d.brands.length === 1) setBrandId(String(d.brands[0].id));
    }).catch(() => setError('โหลดข้อมูลแบรนด์ไม่ได้ — เซิร์ฟเวอร์ทำงานอยู่หรือเปล่า?'));
  }, []);

  function handleReset() {
    setFileName('');
    setResult(null);
    setCommitResult(null);
    setError('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function handleBrandChange(next: string) {
    if (next === brandId) return;
    setBrandId(next);
    handleReset();
  }

  function handleKindChange(next: ImportKind) {
    if (next === kind) return;
    setKind(next);
    handleReset();
  }

  async function handleDownloadTemplate() {
    try {
      await downloadImportTemplate(kind, brandId ? Number(brandId) : undefined);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'ดาวน์โหลด template ไม่สำเร็จ');
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
      setError(err instanceof Error ? err.message : 'ตรวจสอบไฟล์ไม่สำเร็จ');
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
      setToast(`บันทึก Placement สำเร็จ ${res.created} แถว`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'บันทึกข้อมูลไม่สำเร็จ');
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
          <ChevronLeft size={14} /> กลับ
        </Link>
        <h1 className="text-xl font-semibold text-ink tracking-tight">นำเข้า Placement จาก Excel</h1>
        <p className="text-sm text-muted mt-0.5">เหมาะสำหรับกรอกข้อมูลหลายแถวพร้อมกัน — ดาวน์โหลด template, กรอกข้อมูล, แล้วอัปโหลดกลับเข้าระบบ</p>
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

      <div className="space-y-3">
        {/* Brand — แสดงเฉพาะเมื่อ user มีหลาย brand */}
        {brands.length > 1 && (
          <div className={cardCls}>
            <SectionHeader icon={<Tag size={15} />} title="เลือกแบรนด์" />
            <p className="text-sm text-muted mb-3">เลือกแบรนด์ก่อนดาวน์โหลด template — Model ในไฟล์จะมีให้เลือกเฉพาะของแบรนด์นี้เท่านั้น</p>
            <Select
              options={brands.map(b => ({ id: b.id, label: b.name, iconUrl: b.logo_url }))}
              value={brandId}
              onChange={handleBrandChange}
              placeholder="เลือกแบรนด์..."
            />
          </div>
        )}

        {/* Step 0 — choose online/offline template */}
        <div className={cardCls}>
          <SectionHeader icon={kind === 'online' ? <Globe size={15} /> : <Store size={15} />} title="เลือกประเภท Placement ของไฟล์นี้" />
          <p className="text-sm text-muted mb-3">Online และ Offline ใช้ template คนละไฟล์ (คอลัมน์ต่างกัน) — เลือกก่อนดาวน์โหลด/อัปโหลด</p>
          <div className="flex gap-2">
            {(['online', 'offline'] as const).map(k => (
              <button key={k} type="button" onClick={() => handleKindChange(k)}
                className={`flex-1 py-2 rounded-full border text-sm font-medium transition-all active:scale-95 ${
                  kind === k
                    ? 'bg-accent text-white border-accent'
                    : 'bg-transparent text-ink border-hairline hover:border-accent/40 hover:text-accent'
                }`}
              >
                {k === 'online' ? 'Online' : 'Offline (ห้าง/สาขา)'}
              </button>
            ))}
          </div>
        </div>

        {/* Step 1 */}
        <div className={cardCls}>
          <SectionHeader icon={<Download size={15} />} title="ขั้นที่ 1 — ดาวน์โหลด Template" />
          <p className="text-sm text-muted mb-3">ไฟล์ template มี dropdown ให้เลือกในคอลัมน์ที่จำกัดค่าได้ (แบรนด์ / KOL Handle / Platform / Campaign / ประเภทจ่ายเงิน ฯลฯ) พร้อมชีต "รายชื่ออ้างอิง" — เลือก KOL แล้ว Follower/Platform จะขึ้นให้อัตโนมัติ — <strong className="text-ink">ถ้า KOL ที่ต้องการยังไม่อยู่ใน dropdown ต้องเพิ่ม KOL นั้นในเว็บก่อน</strong> (หน้า "เพิ่ม Placement" หรือ KOL Directory) แล้วค่อยดาวน์โหลด template ใหม่อีกครั้ง</p>
          <button type="button" onClick={handleDownloadTemplate} disabled={!brandId}
            className="inline-flex items-center gap-2 px-4 py-2 border border-hairline text-ink text-sm font-medium rounded-full hover:bg-canvas disabled:opacity-50 disabled:cursor-not-allowed active:scale-95 transition-all">
            <Download size={14} /> ดาวน์โหลด Template ({kind === 'online' ? 'Online' : 'Offline'})
          </button>
          {!brandId && brands.length > 1 && <p className="text-xs text-yellow-600 mt-2">กรุณาเลือกแบรนด์ก่อนดาวน์โหลด</p>}
        </div>

        {/* Step 2 */}
        <div className={cardCls}>
          <SectionHeader icon={<Upload size={15} />} title="ขั้นที่ 2 — อัปโหลดไฟล์ที่กรอกแล้ว" />
          <div className="flex items-center gap-3">
            <label className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-full active:scale-95 transition-all cursor-pointer ${
              brandId ? 'bg-accent text-white hover:bg-accent-hover' : 'bg-accent/40 text-white/70 cursor-not-allowed'
            }`}>
              <FileSpreadsheet size={14} />
              เลือกไฟล์ .xlsx
              <input ref={fileInputRef} type="file" accept=".xlsx" className="hidden" onChange={handleFileChange} disabled={!brandId} />
            </label>
            {fileName && <span className="text-sm text-muted truncate max-w-xs">{fileName}</span>}
            {validating && <Loader2 size={16} className="animate-spin text-accent" />}
          </div>
        </div>

        {/* Step 3 — preview */}
        {result && !commitResult && (
          <div className={cardCls}>
            <SectionHeader icon={<CheckCircle2 size={15} />} title="ขั้นที่ 3 — ตรวจสอบและยืนยัน" />

            <div className="mb-4 p-3 bg-canvas rounded-xl text-sm text-ink flex flex-wrap gap-x-4 gap-y-1">
              <span>พบ <strong>{result.summary.total}</strong> แถว</span>
              <span className="text-green-600">พร้อมบันทึก <strong>{result.summary.valid}</strong> แถว</span>
              {result.summary.withErrors > 0 && (
                <span className="text-red-500">มีปัญหา <strong>{result.summary.withErrors}</strong> แถว (จะถูกข้าม)</span>
              )}
            </div>

            <div className="overflow-x-auto -mx-5 px-5">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted uppercase tracking-wide border-b border-hairline">
                    <th className="py-2 pr-3 font-medium">แถว</th>
                    <th className="py-2 pr-3 font-medium">สถานะ</th>
                    <th className="py-2 pr-3 font-medium">แบรนด์</th>
                    <th className="py-2 pr-3 font-medium">KOL Handle</th>
                    <th className="py-2 pr-3 font-medium">รายละเอียด</th>
                    <th className="py-2 pr-3 font-medium">Campaign</th>
                    <th className="py-2 font-medium">หมายเหตุ</th>
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
                            <span className="inline-flex items-center gap-1 text-red-500"><XCircle size={13} /> ข้าม</span>
                          ) : hasWarning ? (
                            <span className="inline-flex items-center gap-1 text-yellow-600"><AlertTriangle size={13} /> คำเตือน</span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-green-600"><CheckCircle2 size={13} /> พร้อม</span>
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
                {committing ? 'กำลังบันทึก...' : `บันทึก ${validRows.length} แถวที่ถูกต้อง`}
              </button>
              <button type="button" onClick={handleReset}
                className="px-5 py-3 border border-hairline text-ink text-sm rounded-full hover:bg-canvas active:scale-95 transition-all">
                เริ่มใหม่
              </button>
            </div>
          </div>
        )}

        {/* Step 4 — commit summary */}
        {commitResult && (
          <div className={cardCls}>
            <SectionHeader icon={<CheckCircle2 size={15} />} title="บันทึกสำเร็จ" />
            <div className="space-y-1 text-sm text-ink mb-4">
              <p>สร้าง Placement ใหม่ <strong>{commitResult.created}</strong> แถว</p>
              {commitResult.branchesCreated > 0 && <p>สร้างสาขาใหม่ <strong>{commitResult.branchesCreated}</strong> สาขา</p>}
              {commitResult.failed.length > 0 && (
                <div className="text-red-500 pt-2">
                  <p>บันทึกไม่สำเร็จ {commitResult.failed.length} แถว:</p>
                  {commitResult.failed.map(f => <p key={f.rowNumber} className="text-xs">แถว {f.rowNumber}: {f.error}</p>)}
                </div>
              )}
              {errorRows.length > 0 && (
                <p className="text-muted pt-2">มี {errorRows.length} แถวที่ข้ามไปตั้งแต่ขั้นตรวจสอบ (มีปัญหา) — แก้ไขในไฟล์แล้วนำเข้าใหม่ได้</p>
              )}
            </div>
            <div className="flex gap-2">
              <Link to="/placements"
                className="flex-1 text-center py-3 bg-accent text-white font-medium rounded-full hover:bg-accent-hover active:scale-[0.99] transition-all text-sm">
                ไปที่รายการ Placement
              </Link>
              <button type="button" onClick={handleReset}
                className="px-5 py-3 border border-hairline text-ink text-sm rounded-full hover:bg-canvas active:scale-95 transition-all">
                นำเข้าไฟล์อื่น
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
