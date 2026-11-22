interface IconProps {
  size?: number;
}

const base = {
  fill: "none",
  stroke: "currentColor",
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

export function ChevronIcon({ size = 14 }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} strokeWidth={2} {...base}>
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}
export function RefreshIcon({ size = 16 }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} strokeWidth={2} {...base}>
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <polyline points="21 3 21 9 15 9" />
    </svg>
  );
}
export function CloseIcon({ size = 16 }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} strokeWidth={2} {...base}>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}
export function PlusIcon({ size = 14 }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} strokeWidth={2} {...base}>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}
export function ActivityIcon({ size = 14 }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} strokeWidth={2} {...base}>
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  );
}
export function RadarIcon({ size = 14 }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} strokeWidth={2} {...base}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="4" />
      <line x1="12" y1="12" x2="20" y2="4" />
    </svg>
  );
}
export function UploadIcon({ size = 14 }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} strokeWidth={2} {...base}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}
export function DownloadIcon({ size = 14 }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} strokeWidth={2} {...base}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}
export function ServerIcon({ size = 30 }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} strokeWidth={1.5} {...base}>
      <rect x="2" y="2" width="20" height="8" rx="2" />
      <rect x="2" y="14" width="20" height="8" rx="2" />
      <line x1="6" y1="6" x2="6.01" y2="6" />
      <line x1="6" y1="18" x2="6.01" y2="18" />
    </svg>
  );
}
export function CheckIcon({ size = 13 }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} strokeWidth={2.2} {...base}>
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
export function XIcon({ size = 13 }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} strokeWidth={2.2} {...base}>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}
export function MoreIcon({ size = 18 }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} strokeWidth={2} {...base}>
      <circle cx="5" cy="12" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
    </svg>
  );
}
