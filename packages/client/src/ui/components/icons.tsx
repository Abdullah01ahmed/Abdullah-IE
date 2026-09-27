/**
 * Inline SVG icons. All are 24-unit viewBoxes drawn with currentColor so they
 * inherit text colour. Directional icons carry `icon-dir` and mirror in RTL.
 */
import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number | string };

function base({ size = 18, className, ...rest }: IconProps, children: React.ReactNode, viewBox = '0 0 24 24') {
  return (
    <svg width={size} height={size} viewBox={viewBox} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className} {...rest}>
      {children}
    </svg>
  );
}

/** Eight-point star (two overlapping squares) — the brand motif. */
export function IconStar8(props: IconProps) {
  return base({ ...props, strokeWidth: 1.4 }, (
    <>
      <rect x="5.5" y="5.5" width="13" height="13" />
      <rect x="5.5" y="5.5" width="13" height="13" transform="rotate(45 12 12)" />
    </>
  ));
}

export function IconChevronBack(props: IconProps) {
  return base({ ...props, className: `icon-dir ${props.className ?? ''}` }, <path d="M15 5l-7 7 7 7" />);
}

export function IconChevronForward(props: IconProps) {
  return base({ ...props, className: `icon-dir ${props.className ?? ''}` }, <path d="M9 5l7 7-7 7" />);
}

export function IconCheck(props: IconProps) {
  return base({ ...props, strokeWidth: 2.4 }, <path d="M5 12.5l4.5 4.5L19 7.5" />);
}

export function IconX(props: IconProps) {
  return base(props, <path d="M6 6l12 12M18 6L6 18" />);
}

export function IconCrown(props: IconProps) {
  return base(props, (
    <>
      <path d="M4 17l-1-9 5 4 4-6 4 6 5-4-1 9z" />
      <path d="M4 20h16" />
    </>
  ));
}

export function IconBot(props: IconProps) {
  return base(props, (
    <>
      <rect x="5" y="8" width="14" height="11" rx="2" />
      <path d="M12 4v4M9 13h.01M15 13h.01M9 16.5h6" />
    </>
  ));
}

export function IconLock(props: IconProps) {
  return base(props, (
    <>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </>
  ));
}

export function IconServer(props: IconProps) {
  return base(props, (
    <>
      <rect x="4" y="4" width="16" height="7" rx="1.5" />
      <rect x="4" y="13" width="16" height="7" rx="1.5" />
      <path d="M8 7.5h.01M8 16.5h.01" />
    </>
  ));
}

export function IconCopy(props: IconProps) {
  return base(props, (
    <>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V6a2 2 0 0 1 2-2h9" />
    </>
  ));
}

export function IconExternal(props: IconProps) {
  return base(props, (
    <>
      <path d="M14 4h6v6M20 4l-9 9" />
      <path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" />
    </>
  ));
}

export function IconWarning(props: IconProps) {
  return base(props, (
    <>
      <path d="M12 3l10 18H2z" />
      <path d="M12 10v4M12 17.5h.01" />
    </>
  ));
}

export function IconInfo(props: IconProps) {
  return base(props, (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" />
    </>
  ));
}

export function IconSkull(props: IconProps) {
  return base(props, (
    <>
      <path d="M12 3a8 8 0 0 0-8 8c0 3 1.5 4.5 3 5.5V20h10v-3.5c1.5-1 3-2.5 3-5.5a8 8 0 0 0-8-8z" />
      <circle cx="9" cy="11" r="1.4" />
      <circle cx="15" cy="11" r="1.4" />
      <path d="M10.5 16h3" />
    </>
  ));
}

/** Head with a crosshair dot — headshot marker. */
export function IconHeadshot(props: IconProps) {
  return base(props, (
    <>
      <circle cx="12" cy="10" r="5" />
      <path d="M6 21c1-3 3.5-4.5 6-4.5s5 1.5 6 4.5" />
      <path d="M12 6v8M8 10h8" strokeWidth={1.2} />
    </>
  ));
}

export function IconKnife(props: IconProps) {
  return base(props, <path d="M4 20l6-6M10 14l9.5-9.5c.6 3-1 6.5-4 8.5L12 16z" />);
}

/** Rifle silhouette (used for the Dijla-7 in the kill feed and loadout). */
export function IconRifle(props: IconProps) {
  return base({ ...props }, (
    <>
      <path d="M2 11h14l3-2h3v3h-3l-1 2h-6l-1 3H8l1-3H2z" />
      <path d="M16 9V7" />
    </>
  ));
}

/** Compact SMG silhouette (Shatt-9). */
export function IconSmg(props: IconProps) {
  return base(props, (
    <>
      <path d="M3 10h12l2-2h4v4h-3l-1 2h-3l-1 5h-3l1-5H8z" />
      <path d="M13 8V6" />
    </>
  ));
}

export function IconSignal(props: IconProps) {
  return base(props, <path d="M4 18v-2M9 18v-6M14 18v-9M19 18V5" />);
}

export function IconGear(props: IconProps) {
  return base(props, (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </>
  ));
}

export function IconMouse(props: IconProps) {
  return base(props, (
    <>
      <rect x="7" y="3" width="10" height="18" rx="5" />
      <path d="M12 7v3" />
    </>
  ));
}

export function IconTrophy(props: IconProps) {
  return base(props, (
    <>
      <path d="M8 4h8v5a4 4 0 0 1-8 0z" />
      <path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4" />
      <path d="M12 13v4M8 21h8M10 17h4v4h-4z" />
    </>
  ));
}

/** Weapon glyph by id / special kill source. */
export function WeaponGlyph({ weapon, size = 18 }: { weapon: string; size?: number }) {
  switch (weapon) {
    case 'dijla7':
      return <IconRifle size={size} />;
    case 'shatt9':
      return <IconSmg size={size} />;
    case 'melee':
      return <IconKnife size={size} />;
    default:
      return <IconSkull size={size} />;
  }
}
