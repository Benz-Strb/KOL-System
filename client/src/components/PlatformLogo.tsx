import { useState } from 'react';
import { getPlatformColor, getPlatformLogo } from '../lib/platformColors.js';

export default function PlatformLogo({ name, size = 22 }: { name?: string | null; size?: number }) {
  const [errored, setErrored] = useState(false);
  const logo = getPlatformLogo(name);
  const bg = getPlatformColor(name);

  return (
    <span
      style={{ width: size, height: size }}
      className={`rounded-full ${bg} shrink-0 flex items-center justify-center`}
      title={name ?? undefined}
    >
      {logo && !errored ? (
        <img src={logo} alt={name ?? ''} onError={() => setErrored(true)} style={{ width: size * 0.58, height: size * 0.58 }} />
      ) : (
        <span className="font-bold text-white" style={{ fontSize: Math.max(8, size * 0.45) }}>
          {name?.slice(0, 1).toUpperCase() ?? '?'}
        </span>
      )}
    </span>
  );
}
