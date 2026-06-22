import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { useModalTransition } from '../hooks/useModalTransition.js';

interface Props {
  title: string;
  onClose: () => void;
  children: ReactNode;
}

export default function Modal({ title, onClose, children }: Props) {
  const { closed, requestClose } = useModalTransition(onClose);
  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 transition-opacity duration-200 ${closed ? 'opacity-0' : 'opacity-100'}`}
      onClick={requestClose}
    >
      <div
        className={`bg-surface border border-hairline rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4 transition-all duration-200 ${closed ? 'opacity-0 scale-95' : 'opacity-100 scale-100'}`}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-ink tracking-tight">{title}</h3>
          <button type="button" onClick={requestClose}
            className="text-muted hover:text-ink hover:bg-canvas rounded-lg p-1 transition-colors">
            <X size={15} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
