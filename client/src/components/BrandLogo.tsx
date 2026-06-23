import { useState } from 'react';

export default function BrandLogo({ name, logoUrl, size = 18 }: { name: string; logoUrl: string | null; size?: number }) {
  const [errored, setErrored] = useState(false);
  if (logoUrl && !errored) {
    return (
      <img
        src={logoUrl}
        alt={name}
        onError={() => setErrored(true)}
        style={{ width: size, height: size }}
        className="rounded-lg object-contain bg-white border border-hairline shrink-0"
      />
    );
  }
  return (
    <span
      style={{ width: size, height: size }}
      className="rounded-lg bg-canvas border border-hairline shrink-0 flex items-center justify-center font-bold text-muted"
      title={name}
    >
      <span style={{ fontSize: Math.max(8, size * 0.45) }}>{name.slice(0, 1).toUpperCase()}</span>
    </span>
  );
}
