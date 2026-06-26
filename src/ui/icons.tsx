/**
 * Coherent inline SVG icon set (lucide-like, 24x24, stroke 1.75).
 * Used by the sidebar, terminal header, and folder path so every glyph
 * shares the same visual weight instead of mixing unicode chars.
 */

type IconProps = { className?: string; size?: number };

export type { IconProps };

function base(size: number, className?: string) {
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.75,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className,
    "aria-hidden": true as const,
  };
}

export function SelectIcon({ className, size = 16 }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="m4 3 7 17 2.5-7.5L21 10z" />
    </svg>
  );
}

export function PanIcon({ className, size = 16 }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M9 11V6a1.5 1.5 0 0 1 3 0v5" />
      <path d="M12 11V4.5a1.5 1.5 0 0 1 3 0V11" />
      <path d="M15 11V6a1.5 1.5 0 0 1 3 0v9a6 6 0 0 1-6 6h-2a6 6 0 0 1-5.6-3.86L3 14.5a1.6 1.6 0 0 1 2.8-1.5L7 15" />
      <path d="M9 11V8a1.5 1.5 0 0 0-3 0v7" />
    </svg>
  );
}

export function NoteIcon({ className, size = 16 }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M15 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10l6-6V5a2 2 0 0 0-2-2z" />
      <path d="M15 21v-5a1 1 0 0 1 1-1h5" />
      <path d="M8 9h6" />
      <path d="M8 13h4" />
    </svg>
  );
}

export function BrowserIcon({ className, size = 16 }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18z" />
    </svg>
  );
}

export function ShellIcon({ className, size = 16 }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="m7 9 3 3-3 3" />
      <path d="M13 15h4" />
    </svg>
  );
}

export function PenIcon({ className, size = 16 }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="m18 2 4 4-13 13-5 1 1-5z" />
      <path d="m15 5 4 4" />
    </svg>
  );
}

export function ArrowIcon({ className, size = 16 }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M7 17 17 7" />
      <path d="M8 7h9v9" />
    </svg>
  );
}

export function EraserIcon({ className, size = 16 }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="m7 21-4-4 10-10 6 6-8 8z" />
      <path d="m14 6 4-4 4 4-4 4" />
      <path d="M11 21h10" />
    </svg>
  );
}

export function SettingsIcon({ className, size = 16 }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

/* ---- terminal header controls ---- */

export function CopyIcon({ className, size = 13 }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V5a2 2 0 0 1 2-2h10" />
    </svg>
  );
}

export function CheckIcon({ className, size = 13 }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="m20 6-11 11-5-5" />
    </svg>
  );
}

export function CloseIcon({ className, size = 13 }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

export function RestartIcon({ className, size = 13 }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 3v5h5" />
    </svg>
  );
}

export function FolderIcon({ className, size = 11 }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </svg>
  );
}
