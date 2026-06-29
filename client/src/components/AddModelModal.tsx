import { useState } from 'react';
import { X, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useModalTransition } from '../hooks/useModalTransition.js';
import Select from './Select.js';
import { createProduct } from '../api/index.js';
import type { ProductCategory } from '../api/index.js';

interface Props {
  onClose: () => void;
  brandId: number;
  productCategories: ProductCategory[];
  onCreated: (product: { id: number; model_code: string }) => void;
}

export default function AddModelModal({ onClose, brandId, productCategories, onCreated }: Props) {
  const { t } = useTranslation();
  const { closed, requestClose } = useModalTransition(onClose);

  const [modelCode, setModelCode] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [duplicateError, setDuplicateError] = useState(false);

  const categoryOptions = productCategories.map(c => ({ id: c.id, label: c.name }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!modelCode.trim() || submitting) return;
    setSubmitting(true);
    setDuplicateError(false);
    try {
      const product = await createProduct({
        model_code: modelCode.trim(),
        brand_id: brandId,
        product_category_id: categoryId ? Number(categoryId) : null,
        image_url: imageUrl.trim() || null,
      });
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

  return (
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

          <div>
            <label className="block text-xs font-medium text-muted mb-1">
              {t('addModel.categoryLabel')}
            </label>
            <Select
              options={[{ id: '', label: '— ไม่ระบุ —' }, ...categoryOptions]}
              value={categoryId}
              onChange={setCategoryId}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-muted mb-1">
              {t('addModel.imageUrlLabel')}
            </label>
            <input
              type="url"
              value={imageUrl}
              onChange={e => setImageUrl(e.target.value)}
              placeholder="https://..."
              className="w-full px-3 py-2 rounded-lg text-sm bg-input-bg border border-input-border text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent"
            />
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
              disabled={!modelCode.trim() || submitting}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-accent text-white hover:bg-accent-hover active:scale-95 disabled:opacity-50 transition-all"
            >
              <Plus size={14} />
              {submitting ? t('common.saving') : t('addModel.save')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
