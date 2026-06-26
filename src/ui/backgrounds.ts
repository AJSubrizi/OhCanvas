/**
 * Animated background videos shipped under /public/backgrounds.
 * Re-encoded to 1080p, 24fps, no audio, H.264 — small enough to bundle.
 */
export interface BackgroundVideo {
  /** filename under /backgrounds */
  file: string;
  /** display name */
  name: string;
}

export const BACKGROUND_VIDEOS: BackgroundVideo[] = [
  { file: "MistyValley.mp4", name: "Misty Valley" },
  { file: "CyberpunkCity.mp4", name: "Cyberpunk City" },
  { file: "1774541064.mp4", name: "Neon Flow" },
  { file: "z350.mp4", name: "Z350" },
  { file: "Luffy.mp4", name: "Luffy" },
  { file: "Zoro.mp4", name: "Zoro" },
  { file: "House.mp4", name: "House" },
];

/** The beautiful animated background used by default (no more static jpg). */
export const DEFAULT_BACKGROUND_VIDEO = "MistyValley.mp4";

/** Resolve a background video file to its public URL. */
export function backgroundVideoUrl(file: string): string {
  return `${import.meta.env.BASE_URL}backgrounds/${file}`;
}
