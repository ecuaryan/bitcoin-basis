import type { ReactNode, SVGProps } from 'react';

type IconProps = Omit<SVGProps<SVGSVGElement>, 'children'> & { size?: number; strokeWidth?: number };

function Icon({ size = 20, strokeWidth = 1.8, children, ...rest }: IconProps & { children: ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
      {children}
    </svg>
  );
}

export const EyeIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
    <circle cx="12" cy="12" r="3" />
  </Icon>
);
export const EyeOffIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 3l18 18" />
    <path d="M10.6 5.1A10.4 10.4 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.5 6.6C3.6 8.5 2 12 2 12s3.5 7 10 7c1.6 0 3-.4 4.3-1" />
    <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
  </Icon>
);
export const LockIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="4" y="11" width="16" height="10" rx="2" />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </Icon>
);
export const HoldingsIcon = (p: IconProps) => (
  <Icon strokeWidth={1.9} {...p}>
    <ellipse cx="12" cy="6" rx="8" ry="3" />
    <path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6" />
    <path d="M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" />
  </Icon>
);
export const WhatIfIcon = (p: IconProps) => (
  <Icon strokeWidth={1.9} {...p}>
    <path d="M4 19V9M10 19V5M16 19v-7M22 19H2" />
  </Icon>
);
export const RecordsIcon = (p: IconProps) => (
  <Icon strokeWidth={1.9} {...p}>
    <rect x="5" y="3" width="14" height="18" rx="2" />
    <path d="M9 8h6M9 12h6M9 16h4" />
  </Icon>
);
export const TaxIcon = (p: IconProps) => (
  <Icon strokeWidth={1.9} {...p}>
    <path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" />
    <path d="M9 8h6M9 12h6" />
  </Icon>
);
export const PlusIcon = ({ strokeWidth = 2.6, ...p }: IconProps) => (
  <Icon strokeWidth={strokeWidth} {...p}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);
export const CloseIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Icon>
);
export const ChevronRightIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M9 6l6 6-6 6" />
  </Icon>
);
export const GearIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3h0a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5h0a1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9v0a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  </Icon>
);
/* Section and entry-point icons (Records tiles, Settings sections): same weight as the nav icons. */
export const ListIcon = (p: IconProps) => (
  <Icon strokeWidth={1.9} {...p}>
    <path d="M9 6h11M9 12h11M9 18h11M4 6h1M4 12h1M4 18h1" />
  </Icon>
);
export const WalletIcon = (p: IconProps) => (
  <Icon strokeWidth={1.9} {...p}>
    <path d="M17 7V5a1 1 0 0 0-1-1H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h13a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1H6a2 2 0 0 1-2-2" />
    <path d="M15.5 13.5h1" />
  </Icon>
);
export const BankIcon = (p: IconProps) => (
  <Icon strokeWidth={1.9} {...p}>
    <path d="M3 9.5h18L12 4z" />
    <path d="M6 12.5v5M10 12.5v5M14 12.5v5M18 12.5v5M3 20.5h18" />
  </Icon>
);
export const ImportExportIcon = (p: IconProps) => (
  <Icon strokeWidth={1.9} {...p}>
    <path d="M8 20V5M4 9l4-4 4 4M16 4v15M12 15l4 4 4-4" />
  </Icon>
);
export const HeartIcon = (p: IconProps) => (
  <Icon strokeWidth={1.9} {...p}>
    <path d="M12 20c-4.5-3-8-6.2-8-10a4 4 0 0 1 8-1 4 4 0 0 1 8 1c0 3.8-3.5 7-8 10z" />
  </Icon>
);
export const LifebuoyIcon = (p: IconProps) => (
  <Icon strokeWidth={1.9} {...p}>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="3.5" />
    <path d="M5.6 5.6l3.9 3.9M14.5 14.5l3.9 3.9M18.4 5.6l-3.9 3.9M9.5 14.5l-3.9 3.9" />
  </Icon>
);
export const DeviceIcon = (p: IconProps) => (
  <Icon strokeWidth={1.9} {...p}>
    <rect x="7" y="3" width="10" height="18" rx="2" />
    <path d="M11 18h2" />
  </Icon>
);
