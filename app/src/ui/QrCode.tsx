import qrcode from 'qrcode-generator';
import { useMemo } from 'react';

/** Module grid for a QR code (error correction M, smallest size that fits). */
export function qrModules(text: string): boolean[][] {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => qr.isDark(r, c)));
}

/**
 * A QR code drawn as one SVG path (no inline styles, so the strict CSP is happy). Always dark on a
 * white square with a 4-module quiet zone, whatever the page theme, so cameras can read it.
 */
export function QrCode({ text, size, label, className }: { text: string; size: number; label: string; className?: string }) {
  const { path, n } = useMemo(() => {
    const m = qrModules(text);
    const parts: string[] = [];
    m.forEach((row, r) => {
      let c = 0;
      while (c < row.length) {
        if (row[c]) {
          let end = c;
          while (end < row.length && row[end]) end++;
          parts.push(`M${c + 4} ${r + 4}h${end - c}v1h${c - end}z`);
          c = end;
        } else c++;
      }
    });
    return { path: parts.join(''), n: m.length + 8 };
  }, [text]);
  return (
    <svg role="img" aria-label={label} width={size} height={size} viewBox={`0 0 ${n} ${n}`} className={className} shapeRendering="crispEdges">
      <rect width={n} height={n} fill="#ffffff" />
      <path d={path} fill="#161514" />
    </svg>
  );
}
