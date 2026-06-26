export interface Theme {
  id: string;
  name: string;
  /** accent color (CSS --accent) */
  accent: string;
  /** any CSS `background` value (url(), gradient, …) for the backdrop.
   *  Only used as fallback when no animated video is active (we now default to videos). */
  background: string;
  /** opacity used when an animated background video is active (0..1). Defaults to 0.55. */
  videoOpacity?: number;
}

export const THEMES: Theme[] = [
  {
    id: "midnight",
    name: "Midnight",
    accent: "#7c9cff",
    background: "radial-gradient(120% 120% at 50% 0%, #0a0c14 0%, #05060a 100%)",
  },
  {
    id: "outrun",
    name: "Outrun",
    accent: "#ff5cc8",
    background: "linear-gradient(180deg, #241a47 0%, #7a2a6a 48%, #ff7a59 100%)",
  },
  {
    id: "aurora",
    name: "Aurora",
    accent: "#4ade80",
    background: "linear-gradient(180deg, #061018 0%, #0a3a3a 52%, #1a6a5a 100%)",
  },
  {
    id: "mono",
    name: "Mono",
    accent: "#a8b3cf",
    background: "radial-gradient(120% 120% at 50% 0%, #1b2030 0%, #05060a 100%)",
  },
];

export const DEFAULT_THEME_ID = "midnight";

export function getTheme(id: string): Theme {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}
