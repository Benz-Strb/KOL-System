import { useEffect, useState } from 'react';
import { CheckCircle, X } from 'lucide-react';

interface Props {
  message: string;
  onClose: () => void;
  duration?: number;
}

export default function Toast({ message, onClose, duration = 3000 }: Props) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const show = setTimeout(() => setVisible(true), 10);
    const hide = setTimeout(() => setVisible(false), duration - 300);
    const remove = setTimeout(onClose, duration);
    return () => { clearTimeout(show); clearTimeout(hide); clearTimeout(remove); };
  }, [duration, onClose]);

  return (
    <div className={`fixed top-5 right-5 z-50 flex items-center gap-3 bg-surface border border-hairline shadow-lg rounded-2xl px-4 py-3 transition-all duration-300 ${
      visible ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2'
    }`}>
      <CheckCircle size={16} className="text-green-500 flex-shrink-0" />
      <span className="text-sm text-ink">{message}</span>
      <button onClick={onClose} className="text-muted hover:text-ink transition-colors ml-1">
        <X size={13} />
      </button>
    </div>
  );
}
