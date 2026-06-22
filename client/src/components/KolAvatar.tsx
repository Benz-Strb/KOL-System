import { useState } from 'react';
import { getAvatarColor } from '../lib/avatarColor.js';

export default function KolAvatar({
  handle, avatarUrl, size = 'md',
}: { handle: string; avatarUrl?: string | null; size?: 'sm' | 'md' }) {
  const [errored, setErrored] = useState(false);
  const cleanHandle = handle.replace(/^[@.]/, '');
  const initial = cleanHandle.slice(0, 1).toUpperCase() || '?';
  const [bg, fg] = getAvatarColor(handle);
  const dim = size === 'sm' ? 'w-9 h-9 text-xs' : 'w-10 h-10 text-sm';

  if (avatarUrl && !errored) {
    return (
      <img
        src={avatarUrl}
        alt={handle}
        onError={() => setErrored(true)}
        className={`${dim} rounded-xl object-cover shrink-0 bg-canvas`}
      />
    );
  }
  return (
    <span className={`inline-flex items-center justify-center ${dim} rounded-xl font-bold shrink-0 ${bg} ${fg}`}>
      {initial}
    </span>
  );
}
