import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Pencil, Trash2, Plus, Check } from 'lucide-react';
import { useModalTransition } from '../hooks/useModalTransition.js';
import {
  createProductCategory, updateProductCategory, deleteProductCategory,
  type ProductCategory,
} from '../api/index.js';

interface Props {
  onClose: () => void;
  categories: ProductCategory[];
  isAdmin: boolean;
  onChange: (next: ProductCategory[]) => void;
}

export default function ManageCategoriesModal({ onClose, categories, isAdmin, onChange }: Props) {
  const { t } = useTranslation();
  const { closed, requestClose } = useModalTransition(onClose);

  const [newName, setNewName] = useState('');
  const [addError, setAddError] = useState('');
  const [adding, setAdding] = useState(false);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [editError, setEditError] = useState('');
  const [editSaving, setEditSaving] = useState(false);

  const [deletingId, setDeletingId] = useState<number | null>(null);

  async function handleAdd() {
    const trimmed = newName.trim();
    if (!trimmed || adding) return;
    setAddError('');
    setAdding(true);
    try {
      const created = await createProductCategory(trimmed);
      const next = [...categories.filter(c => c.id !== created.id), created]
        .sort((a, b) => a.name.localeCompare(b.name));
      onChange(next);
      setNewName('');
    } catch (e: unknown) {
      if (e instanceof Error && e.message === 'duplicate') {
        setAddError(t('manageCategories.duplicate'));
      } else {
        setAddError(t('common.error'));
      }
    } finally {
      setAdding(false);
    }
  }

  async function handleEdit(id: number) {
    const trimmed = editName.trim();
    if (!trimmed || editSaving) return;
    setEditError('');
    setEditSaving(true);
    try {
      const updated = await updateProductCategory(id, trimmed);
      const next = categories.map(c => c.id === id ? updated : c)
        .sort((a, b) => a.name.localeCompare(b.name));
      onChange(next);
      setEditingId(null);
    } catch (e: unknown) {
      if (e instanceof Error && e.message === 'duplicate') {
        setEditError(t('manageCategories.duplicate'));
      } else {
        setEditError(t('common.error'));
      }
    } finally {
      setEditSaving(false);
    }
  }

  async function handleDelete(id: number) {
    if (!confirm(t('manageCategories.confirmDelete'))) return;
    setDeletingId(id);
    try {
      await deleteProductCategory(id);
      onChange(categories.filter(c => c.id !== id));
    } catch {
      // silent — extremely rare (soft delete)
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div
      className={`fixed inset-0 z-[60] flex items-center justify-center bg-black/60 px-4 transition-opacity duration-200 ${closed ? 'opacity-0' : 'opacity-100'}`}
      onClick={e => { e.stopPropagation(); requestClose(); }}
    >
      <div
        className={`bg-surface border border-hairline rounded-2xl shadow-xl w-full max-w-sm transition-all duration-200 ${closed ? 'opacity-0 scale-95' : 'opacity-100 scale-100'}`}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-hairline">
          <h3 className="text-sm font-semibold text-ink">{t('manageCategories.title')}</h3>
          <button type="button" onClick={requestClose}
            className="text-muted hover:text-ink hover:bg-canvas rounded-lg p-1 transition-colors">
            <X size={14} />
          </button>
        </div>

        {/* Add row (ทุก role) */}
        <div className="px-5 pt-4 pb-2">
          <div className="flex gap-2">
            <input
              type="text"
              value={newName}
              onChange={e => { setNewName(e.target.value); setAddError(''); }}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAdd(); } }}
              placeholder={t('manageCategories.addPlaceholder')}
              className="flex-1 px-3 py-2 text-sm rounded-lg bg-input-bg border border-input-border text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent"
            />
            <button
              type="button"
              onClick={handleAdd}
              disabled={!newName.trim() || adding}
              className="inline-flex items-center gap-1 px-3 py-2 bg-accent text-white text-sm font-medium rounded-lg hover:bg-accent-hover disabled:opacity-50 transition-all"
            >
              <Plus size={13} />
              {t('manageCategories.add')}
            </button>
          </div>
          {addError && <p className="text-xs text-red-500 mt-1">{addError}</p>}
        </div>

        {/* List */}
        <div className="px-5 pb-5 max-h-64 overflow-y-auto space-y-1 mt-2">
          {categories.length === 0 && (
            <p className="text-sm text-muted text-center py-4">{t('manageCategories.empty')}</p>
          )}
          {categories.map(cat => (
            <div key={cat.id}
              className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-canvas transition-colors">
              {editingId === cat.id ? (
                <>
                  <input
                    autoFocus
                    type="text"
                    value={editName}
                    onChange={e => { setEditName(e.target.value); setEditError(''); }}
                    onKeyDown={e => {
                      if (e.key === 'Enter') { e.preventDefault(); handleEdit(cat.id); }
                      if (e.key === 'Escape') { setEditingId(null); setEditError(''); }
                    }}
                    className="flex-1 px-2 py-1 text-sm rounded-md bg-input-bg border border-input-border text-ink focus:outline-none focus:ring-2 focus:ring-accent"
                  />
                  <button onClick={() => handleEdit(cat.id)} disabled={editSaving}
                    className="text-accent hover:text-accent-hover disabled:opacity-50 transition-colors">
                    <Check size={13} />
                  </button>
                  <button onClick={() => { setEditingId(null); setEditError(''); }}
                    className="text-muted hover:text-ink transition-colors">
                    <X size={13} />
                  </button>
                  {editError && <p className="text-xs text-red-500 absolute mt-8">{editError}</p>}
                </>
              ) : (
                <>
                  <span className="flex-1 text-sm text-ink">{cat.name}</span>
                  {isAdmin && (
                    <>
                      <button
                        onClick={() => { setEditingId(cat.id); setEditName(cat.name); setEditError(''); }}
                        className="text-muted hover:text-accent transition-colors p-0.5">
                        <Pencil size={12} />
                      </button>
                      <button
                        onClick={() => handleDelete(cat.id)}
                        disabled={deletingId === cat.id}
                        className="text-muted hover:text-red-500 disabled:opacity-40 transition-colors p-0.5">
                        <Trash2 size={12} />
                      </button>
                    </>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
