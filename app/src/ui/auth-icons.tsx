import type { ReactNode, SVGProps } from 'react';

type IconProps = Omit<SVGProps<SVGSVGElement>, 'children'> & { size?: number; strokeWidth?: number };

function Icon({ size = 20, strokeWidth = 2, children, ...rest }: IconProps & { children: ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
      {children}
    </svg>
  );
}

export const PrinterIcon = (p: IconProps) => (
  <Icon strokeWidth={2.2} {...p}>
    <path d="M7 9V3h10v6" />
    <rect x="3" y="9" width="18" height="8" rx="2" />
    <path d="M7 14h10v7H7z" />
  </Icon>
);
export const FaceIdIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" />
    <path d="M9 10v1M15 10v1M12 10v3h-1M9.5 15.5c1.5 1 3.5 1 5 0" />
  </Icon>
);
export const FingerprintIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 11v3.5c0 2-.5 3.6-1.5 5M8 14c0 2-.3 3.6-1 5M16 13c0 3-.6 5-1.6 7" />
    <path d="M5 11a7 7 0 0 1 14 0M8.5 11a3.5 3.5 0 0 1 7 0" />
    <path d="M3.5 8.2A9.5 9.5 0 0 1 12 2.5c3.5 0 6.4 1.8 8 4.5" />
  </Icon>
);
export const KeyIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="8" cy="15" r="4" />
    <path d="M11 12l9-9M16 7l3 3M14 9l2 2" />
  </Icon>
);
export const ShieldCheckIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" />
    <path d="M9 12l2 2 4-4" />
  </Icon>
);
