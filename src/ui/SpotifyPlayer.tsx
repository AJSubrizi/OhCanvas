import { useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { useCanvasStore } from "../state/store";
import {
  normalizeMediaEmbedUrl,
  parseMediaUrl,
  providerLabel,
  type MediaEmbed,
} from "./mediaProviders";

const DOCK_MARGIN = 14;
const COLLAPSED_WIDTH = 100;
const OPEN_WIDTH = 380;
const TOGGLE_HEIGHT = 32;
const OPEN_HEIGHT = 560;
const MEDIA_RECENTS_KEY = "ohcanvas:media-recents";

export function normalizeSpotifyEmbedUrl(input: string) {
  return normalizeMediaEmbedUrl(input);
}

export default function SpotifyPlayer() {
  const embedUrl = useCanvasStore((s) => s.spotifyEmbedUrl);
  const open = useCanvasStore((s) => s.spotifyPlayerOpen);
  const position = useCanvasStore((s) => s.spotifyPosition);
  const setOpen = useCanvasStore((s) => s.setSpotifyPlayerOpen);
  const setPosition = useCanvasStore((s) => s.setSpotifyPosition);
  const setEmbedUrl = useCanvasStore((s) => s.setSpotifyEmbedUrl);
  const dockRef = useRef<HTMLElement>(null);
  const [draft, setDraft] = useState("");
  const [message, setMessage] = useState("");
  const [recents, setRecents] = useState<MediaEmbed[]>(loadRecents);
  const currentMedia = embedUrl ? mediaFromEmbed(embedUrl) : null;
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    offsetX: number;
    offsetY: number;
    moved: boolean;
  } | null>(null);

  const size = {
    width: open ? OPEN_WIDTH : COLLAPSED_WIDTH,
    height: open ? OPEN_HEIGHT : TOGGLE_HEIGHT,
  };
  const currentPosition = position ?? {
    x: Math.max(DOCK_MARGIN, window.innerWidth - size.width - DOCK_MARGIN),
    y: 52,
  };

  const clampedPosition = useMemo(
    () => clampToViewport(currentPosition, size),
    [currentPosition.x, currentPosition.y, size.width, size.height],
  );

  if (!embedUrl) return null;

  const setMedia = (media: MediaEmbed) => {
    setEmbedUrl(media.embedUrl);
    setOpen(true);
    setMessage(media.label);
    const next = saveRecent(media);
    setRecents(next);
    useCanvasStore.getState().saveCanvas();
  };

  const saveDraft = () => {
    const media = parseMediaUrl(draft);
    if (!media) {
      setMessage("Paste a Spotify, YouTube, YouTube Music, or Apple Music link");
      return;
    }
    setDraft("");
    setMedia(media);
  };

  const openExternal = async () => {
    const externalUrl = currentMedia?.externalUrl ?? embedUrl;
    try {
      if ("__TAURI_INTERNALS__" in window) {
        const { openUrl } = await import("@tauri-apps/plugin-opener");
        await openUrl(externalUrl);
      } else {
        window.open(externalUrl, "_blank", "noopener,noreferrer");
      }
    } catch {
      window.open(externalUrl, "_blank", "noopener,noreferrer");
    }
  };

  const commitPosition = (next: { x: number; y: number }) => {
    setPosition(clampToViewport(next, size));
  };

  const cleanupDragListeners = () => {
    window.removeEventListener("pointermove", globalPointerMove);
    window.removeEventListener("pointerup", globalPointerUp);
    window.removeEventListener("pointercancel", globalPointerCancel);
  };

  const globalPointerMove = (event: PointerEvent) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const next = {
      x: event.clientX - drag.offsetX,
      y: event.clientY - drag.offsetY,
    };
    if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 4) drag.moved = true;
    commitPosition(next);
  };

  const globalPointerUp = (event: PointerEvent) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    cleanupDragListeners();
    if (drag.moved) {
      const rect = dockRef.current?.getBoundingClientRect();
      const width = rect?.width ?? size.width;
      const height = rect?.height ?? size.height;
      const raw = {
        x: event.clientX - drag.offsetX,
        y: event.clientY - drag.offsetY,
      };
      setPosition(snapToNearestEdge(raw, { width, height }));
      useCanvasStore.getState().saveCanvas();
      return;
    }
    setOpen(!open);
  };

  const globalPointerCancel = (event: PointerEvent) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    cleanupDragListeners();
  };

  const pointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const rect = dockRef.current?.getBoundingClientRect();
    if (!rect) return;
    event.preventDefault();
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      moved: false,
    };
    window.addEventListener("pointermove", globalPointerMove);
    window.addEventListener("pointerup", globalPointerUp);
    window.addEventListener("pointercancel", globalPointerCancel);
  };

  return (
    <section
      ref={dockRef}
      className={`spotify-player media-player ${open ? "is-open" : ""}`}
      aria-label="Media player"
      style={{ left: clampedPosition.x, top: clampedPosition.y }}
    >
      <button
        className="spotify-player__toggle"
        data-tauri-drag-region="false"
        onPointerDown={pointerDown}
        onPointerCancel={() => {
          dragRef.current = null;
          cleanupDragListeners();
        }}
        title={open ? "Collapse media" : "Open media"}
        aria-expanded={open}
      >
        <span aria-hidden="true">♪</span>
        <span>Media</span>
      </button>
      {open && (
        <>
          <div className="media-player__provider">
            <span>{currentMedia ? providerLabel(currentMedia.provider) : "Media"}</span>
            <button onClick={() => void openExternal()}>Open</button>
          </div>
        </>
      )}
      {/* The iframe is rendered even when collapsed so playback keeps running.
          It is hidden via CSS rather than unmounted (unmounting stops audio). */}
      <div className={`spotify-player__body ${open ? "is-visible" : "is-hidden"}`}>
        <iframe
          title="Media embed"
          src={embedUrl}
          width="100%"
          height="280"
          allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
          loading="lazy"
        />
        {open && (
          <div className="spotify-player__picker">
            <div className="spotify-player__tools">
              <input
                value={draft}
                placeholder="Paste Spotify, YouTube, YouTube Music, or Apple Music"
                onChange={(event) => {
                  setDraft(event.target.value);
                  setMessage("");
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") saveDraft();
                }}
              />
              <button onClick={saveDraft}>Set</button>
            </div>
            <div className="media-player__chips" aria-label="Supported providers">
              <span>Spotify</span>
              <span>YouTube</span>
              <span>YouTube Music</span>
              <span>Apple Music</span>
            </div>
            {recents.length > 0 && (
              <div className="spotify-player__list media-player__recents">
                {recents.map((item) => (
                  <button key={item.embedUrl} onClick={() => setMedia(item)}>
                    <span className={`media-player__mark media-player__mark--${item.provider}`} />
                    <span>
                      <strong>{providerLabel(item.provider)}</strong>
                      <small>{recentLabel(item)}</small>
                    </span>
                  </button>
                ))}
              </div>
            )}
            {message && <p className="spotify-player__message">{message}</p>}
          </div>
        )}
        {open && (
          <div className="spotify-player__footer">
            <span className="spotify-player__hint">Native embeds, no login needed</span>
            <button className="spotify-player__open" onClick={() => void openExternal()}>
              Open external
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

function mediaFromEmbed(embedUrl: string): MediaEmbed | null {
  if (embedUrl.includes("open.spotify.com/embed")) {
    return { provider: "spotify", label: "Spotify", embedUrl, externalUrl: embedUrl.replace("/embed/", "/") };
  }
  if (embedUrl.includes("youtube.com/embed")) {
    return { provider: "youtube", label: "YouTube video", embedUrl, externalUrl: embedUrl };
  }
  if (embedUrl.includes("embed.music.apple.com")) {
    return { provider: "apple-music", label: "Apple Music", embedUrl, externalUrl: embedUrl.replace("embed.music.apple.com", "music.apple.com") };
  }
  return null;
}

function recentLabel(media: MediaEmbed) {
  if (media.label === providerLabel(media.provider)) {
    if (media.provider === "youtube") return "YouTube video";
    if (media.provider === "youtube-music") return "YouTube Music video";
  }
  return media.label;
}

function loadRecents(): MediaEmbed[] {
  try {
    const raw = localStorage.getItem(MEDIA_RECENTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as MediaEmbed[];
    return Array.isArray(parsed) ? parsed.slice(0, 6) : [];
  } catch {
    return [];
  }
}

function saveRecent(media: MediaEmbed) {
  const next = [media, ...loadRecents().filter((item) => item.embedUrl !== media.embedUrl)].slice(0, 6);
  try {
    localStorage.setItem(MEDIA_RECENTS_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  return next;
}

function clampToViewport(position: { x: number; y: number }, size: { width: number; height: number }) {
  return {
    x: Math.min(Math.max(DOCK_MARGIN, position.x), Math.max(DOCK_MARGIN, window.innerWidth - size.width - DOCK_MARGIN)),
    y: Math.min(Math.max(DOCK_MARGIN, position.y), Math.max(DOCK_MARGIN, window.innerHeight - size.height - DOCK_MARGIN)),
  };
}

function snapToNearestEdge(position: { x: number; y: number }, size: { width: number; height: number }) {
  const clamped = clampToViewport(position, size);
  const distances = [
    { edge: "left", value: clamped.x - DOCK_MARGIN },
    { edge: "right", value: window.innerWidth - (clamped.x + size.width) - DOCK_MARGIN },
    { edge: "top", value: clamped.y - DOCK_MARGIN },
    { edge: "bottom", value: window.innerHeight - (clamped.y + size.height) - DOCK_MARGIN },
  ].sort((a, b) => a.value - b.value);

  const edge = distances[0].edge;
  if (edge === "left") return { ...clamped, x: DOCK_MARGIN };
  if (edge === "right") return { ...clamped, x: window.innerWidth - size.width - DOCK_MARGIN };
  if (edge === "top") return { ...clamped, y: DOCK_MARGIN };
  return { ...clamped, y: window.innerHeight - size.height - DOCK_MARGIN };
}
