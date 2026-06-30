import { useState, useRef } from 'react';
import { X, Plus, ImagePlus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useModalTransition } from '../hooks/useModalTransition.js';
import Select from './Select.js';
import ManageCategoriesModal from './ManageCategoriesModal.js';
import { createProduct, uploadProductImage, clearDropdownCache } from '../api/index.js';
import type { ProductCategory } from '../api/index.js';

const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_SIZE = 2 * 1024 * 1024;

interface Props {
  onClose: () => void;
  brandId: number;
  productCategories: ProductCategory[];
  onCreated: (product: { id: number; model_code: string }) => void;
  isAdmin?: boolean;
}

export default function AddModelModal({ onClose, brandId, productCategories, onCreated, isAdmin = false }: Props) {
  const { t } = useTranslation();
  const { closed, requestClose } = useModalTransition(onClose);

  const [modelCode, setModelCode] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [duplicateError, setDuplicateError] = useState(false);
  const [categories, setCategories] = useState(productCategories);
  const [showManage, setShowManage] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const categoryOptions = categories.map(c => ({ id: c.id, label: c.name }));

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!e.target) return;
    e.target.value = '';
    if (!file) return;

    setUploadError(null);
    if (!ALLOWED_TYPES.has(file.type)) {
      setUploadError(t('addModel.invalidImageType'));
      return;
    }
    if (file.size > MAX_SIZE) {
      setUploadError(t('addModel.imageTooLarge'));
      return;
    }

    setUploading(true);
    try {
      const { url } = await uploadProductImage(file);
      setImageUrl(url);
    } catch {
      setUploadError(t('addModel.uploadError'));
    } finally {
      setUploading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!modelCode.trim() || submitting || uploading) return;
    setSubmitting(true);
    setDuplicateError(false);
    try {
      const product = await createProduct({
        model_code: modelCode.trim(),
        brand_id: brandId,
        product_category_id: categoryId ? Number(categoryId) : null,
        image_url: imageUrl || null,
      });
      clearDropdownCache();
      onCreated(product);
      requestClose();
    } catch (err: unknown) {
      if (err instanceof Error && err.message === 'duplicate') {
        setDuplicateError(true);
      }
    } finally {
      setSubmitting(false);
    }
  }

  function handleCategoriesChange(next: ProductCategory[]) {
    setCategories(next);
    clearDropdownCache();
  }

  return (
    <>
      <div
        className={`fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 transition-opacity duration-200 ${closed ? 'opacity-0' : 'opacity-100'}`}
        onClick={requestClose}
      >
        <div
          className={`bg-surface border border-hairline rounded-2xl shadow-xl w-full max-w-md p-6 transition-all duration-200 ${closed ? 'opacity-0 scale-95' : 'opacity-100 scale-100'}`}
          onClick={e => e.stopPropagation()}
        >
          <div className="flex items-center justify-between mb-5">
            <h3 className="text-base font-semibold text-ink">{t('addModel.addModelTitle')}</h3>
            <button type="button" onClick={requestClose}
              className="text-muted hover:text-ink hover:bg-canvas rounded-lg p-1 transition-colors">
              <X size={15} />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Model code */}
            <div>
              <label className="block text-xs font-medium text-muted mb-1">
                {t('addModel.modelCodeLabel')} <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={modelCode}
                onChange={e => { setModelCode(e.target.value); setDuplicateError(false); }}
                placeholder={t('addModel.modelCodePlaceholder')}
                className="w-full px-3 py-2 rounded-lg text-sm bg-input-bg border border-input-border text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent"
                autoFocus
              />
              {duplicateError && (
                <p className="text-xs text-red-500 mt-1">{t('addModel.duplicateError')}</p>
              )}
            </div>

            {/* หมวดหมู่ + ลิงก์จัดการ */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-medium text-muted">
                  {t('addModel.categoryLabel')}
                </label>
                <button
                  type="button"
                  onClick={() => setShowManage(true)}
                  className="text-xs text-accent hover:text-accent-hover transition-colors"
                >
                  {t('addModel.manageCategories')}
                </button>
              </div>
              <Select
                options={[{ id: '', label: '— ไม่ระบุ —' }, ...categoryOptions]}
                value={categoryId}
                onChange={setCategoryId}
              />
            </div>

            {/* รูปสินค้า */}
            <div>
              <label className="block text-xs font-medium text-muted mb-1">
                {t('addModel.imageLabel')}
              </label>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={handleFileChange}
                className="hidden"
              />
              {imageUrl ? (
                <div className="flex items-center gap-3 mt-1">
                  <img
                    src={imageUrl}
                    alt=""
                    className="w-20 h-20 rounded-lg object-cover border border-hairline flex-shrink-0"
                  />
                  <button
                    type="button"
                    onClick={() => { setImageUrl(''); setUploadError(null); }}
                    className="text-xs text-muted hover:text-red-500 transition-colors flex items-center gap-1"
                  >
                    <X size={12} />
                    {t('addModel.removeImage')}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed border-input-border text-sm text-muted hover:border-accent/40 hover:text-ink disabled:opacity-60 transition-colors w-full"
                >
                  <ImagePlus size={14} />
                  {uploading ? t('addModel.uploading') : t('addModel.chooseImage')}
                </button>
              )}
              {uploadError && <p className="text-xs text-red-500 mt-1">{uploadError}</p>}
            </div>

            <div className="flex justify-end gap-2 mt-6">
              <button
                type="button"
                onClick={requestClose}
                className="px-4 py-2 rounded-lg text-sm text-muted hover:text-ink hover:bg-canvas transition-colors"
              >
                {t('addModel.cancel')}
              </button>
              <button
                type="submit"
                disabled={!modelCode.trim() || submitting || uploading}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-accent text-white hover:bg-accent-hover active:scale-95 disabled:opacity-50 transition-all"
              >
                <Plus size={14} />
                {submitting ? t('common.saving') : t('addModel.save')}
              </button>
            </div>
          </form>
        </div>
      </div>

      {showManage && (
        <ManageCategoriesModal
          onClose={() => setShowManage(false)}
          categories={categories}
          isAdmin={isAdmin}
          onChange={handleCategoriesChange}
        />
      )}
    </>
  );
}
