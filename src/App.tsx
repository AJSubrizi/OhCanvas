import { useEffect } from "react";
import Canvas from "./canvas/Canvas";
import Navbar from "./ui/Navbar";
import CommandBar from "./ui/CommandBar";
import SpotifyPlayer from "./ui/SpotifyPlayer";
import ConnectionStatus from "./ui/ConnectionStatus";
import PreviewDock from "./ui/PreviewDock";
import PreviewSuggestionToast from "./ui/PreviewSuggestionToast";
import { sidecar } from "./bridge/sidecar";
import { useCanvasStore } from "./state/store";
import { getTheme } from "./ui/themes";
import { backgroundVideoUrl } from "./ui/backgrounds";
import { prepareVoice } from "./ui/voice";
import { ensureLlmModel } from "./ui/llm";

export default function App() {
  const backgroundImage = useCanvasStore((s) => s.backgroundImage);
  const backgroundVideo = useCanvasStore((s) => s.backgroundVideo);
  const themeId = useCanvasStore((s) => s.themeId);
  const theme = getTheme(themeId);
  const lastAction = useCanvasStore((s) => s.lastCanvasAction);
  // Heavy backdrop-filter blur is fine for a few cards, but with many terminals
  // (each re-blurring the animated background every frame) it gets expensive.
  // Switch to a cheaper, more opaque card style past a threshold.
  const perfMode = useCanvasStore(
    (s) => s.flowNodes.filter((n) => n.type === "terminal").length >= 6,
  );

  useEffect(() => {
    document.documentElement.style.setProperty("--accent", theme.accent);
  }, [theme.accent]);

  // Auto clear last agent action after a few seconds
  useEffect(() => {
    if (lastAction) {
      const t = setTimeout(() => useCanvasStore.getState().setLastCanvasAction(null), 4500);
      return () => clearTimeout(t);
    }
  }, [lastAction]);

  useEffect(() => {
    sidecar.connect();
    void prepareVoice(); // ensures model only (no automatic listening)
    // Pre-fetch the SmolLM2 conductor model so the first voice command isn't
    // delayed by the (~105 MB) download.
    void ensureLlmModel();

    // Restore previous canvas (positions + static nodes). Async because
    // the persistence layer may read from disk (<app_data_dir>/state/...).
    useCanvasStore
      .getState()
      .loadCanvas()
      .catch((e) => console.warn("[canvas] initial load failed", e));

    // Auto-save layout/settings promptly, but debounce noisy drag/resize updates
    // and ignore terminal output churn.
    const save = () => useCanvasStore.getState().saveCanvas();
    let lastSignature = persistenceSignature();
    let saveTimer: number | undefined;
    // The store fires a subscriber on *every* mutation — drag frames (many per
    // second) and live voice-caption updates included. Computing the full
    // JSON.stringify signature on each of those was the hot path, so coalesce
    // bursts into at most one signature check per 400ms. The 15s interval +
    // visibilitychange + unmount saves still guarantee nothing is lost.
    let checkTimer: number | undefined;
    const scheduleCheck = () => {
      if (checkTimer != null) return;
      checkTimer = window.setTimeout(() => {
        checkTimer = undefined;
        const nextSignature = persistenceSignature();
        if (nextSignature === lastSignature) return;
        lastSignature = nextSignature;
        window.clearTimeout(saveTimer);
        saveTimer = window.setTimeout(save, 800);
      }, 400);
    };
    const unsubscribe = useCanvasStore.subscribe(scheduleCheck);

    const interval = window.setInterval(save, 15000);
    const onHide = () => save();
    document.addEventListener("visibilitychange", onHide);

    return () => {
      unsubscribe();
      window.clearTimeout(saveTimer);
      window.clearTimeout(checkTimer);
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onHide);
      save();
    };
  }, []);

  return (
    <div className={`app${perfMode ? " perf-mode" : ""}`}>
      {/* Top strip: allows dragging the desktop window like a normal app (fixes "cannot move on screen") */}
      <div className="window-drag-region" data-tauri-drag-region aria-hidden="true" />

      {backgroundVideo ? (
        <video
          // key forces a full remount when the video file changes, so the
          // <source> actually reloads. Without this, React keeps the same
          // media element and the browser never picks up the new src.
          key={backgroundVideo}
          className="bg-image bg-video"
          aria-hidden="true"
          autoPlay
          loop
          muted
          playsInline
          // Surface the animated backdrop close to its original colors (themes
          // can override with a lower opacity for legibility if needed).
          style={{ opacity: theme.videoOpacity ?? 0.9 }}
        >
          <source src={backgroundVideoUrl(backgroundVideo)} type="video/mp4" />
        </video>
      ) : (
        // Fallback only for custom user-selected static images (animated is default)
        <div
          className="bg-image"
          aria-hidden="true"
          style={{
            background: backgroundImage
              ? `url(${backgroundImage}) center/cover no-repeat`
              : theme.background,
          }}
        />
      )}
      <div className="canvas-layer">
        <Canvas />
      </div>
      <Navbar />
      <CommandBar />
      <SpotifyPlayer />
      <ConnectionStatus />

      {/* Right-docked live preview (mirrors a terminal's dev server) */}
      <PreviewDock />
      {/* Non-invasive dev-server detection prompts */}
      <PreviewSuggestionToast />

      {/* Simple floating inspector for selected node */}
      <SelectedInspector />
    </div>
  );
}

function SelectedInspector() {
  const selected = useCanvasStore((s) =>
    s.flowNodes.find((n) => n.selected)
  );
  const lastAction = useCanvasStore((s) => s.lastCanvasAction);
  if (!selected && !lastAction) return null;

  const data = selected?.data as any;
  const title = data?.title || data?.text || data?.label || selected?.type || "OhCanvas";
  const cwd = data?.cwd || data?.url || "";

  return (
    <div
      className="selected-inspector"
      style={{
        position: "fixed",
        top: 14,
        left: "calc(50% + 360px)",
        zIndex: 30,
        background: "rgba(10,12,20,0.92)",
        border: "1px solid rgba(255,255,255,0.1)",
        borderRadius: 8,
        padding: "8px 12px",
        fontSize: 12,
        maxWidth: 280,
        boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
        backdropFilter: "blur(8px)",
      }}
    >
      {selected && (
        <>
          <div style={{ fontWeight: 600, marginBottom: 2 }}>{title}</div>
          <div style={{ color: "var(--text-dim)", fontSize: 11 }}>{selected.type} • {cwd ? cwd : "no folder"}</div>
        </>
      )}
      {lastAction && (
        <div style={{ fontSize: 10, color: "#7c9cff", marginTop: 4, opacity: 0.9 }}>
          {lastAction}
        </div>
      )}
      <div style={{ fontSize: 10, opacity: 0.6, marginTop: 4 }}>Agents can control the canvas via OHCANVAS</div>
    </div>
  );
}

function persistenceSignature() {
  const state = useCanvasStore.getState();
  return JSON.stringify({
    nodes: state.flowNodes,
    boardMarks: state.boardMarks,
    backgroundImage: state.backgroundImage,
    backgroundVideo: state.backgroundVideo,
    spotifyEmbedUrl: state.spotifyEmbedUrl,
    spotifyPlayerOpen: state.spotifyPlayerOpen,
    spotifyPosition: state.spotifyPosition,
    autoArrange: state.autoArrange,
    previewOpen: state.previewOpen,
    previewUrl: state.previewUrl,
    previewDevice: state.previewDevice,
    previewTerminalId: state.previewTerminalId,
  });
}
