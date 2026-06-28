# 🎨 OhCanvas

**Infinite canvas with real terminals, browser nodes, drawing tools, and AI agent integration.** 

OhCanvas is an open-source desktop app — an infinite whiteboard where you spawn PTY-backed terminals, browse the web inside canvas nodes, draw arrows and freehand marks, take notes, and control everything from a CLI agent. Built with **Tauri 2 + React + Konva**.

---

## 🚀 Installation

```bash
# Prerequisites: Node 20+, pnpm 9+, Rust 1.77+, Xcode CLI Tools (macOS)

git clone https://github.com/AJSubrizi/OhCanvas.git
cd OhCanvas
pnpm install

# Development (sidecar + Tauri window)
pnpm dev

# Web-only frontend (no Tauri window)
pnpm dev:web

# Production build
pnpm tauri build
```

> **Pi CLI**: to use Pi, run `pi` once in your terminal to authenticate.

---

## 🧱 Project structure

```
ohcanvas/
├── src/                          # React + TypeScript frontend
│   ├── App.tsx                   # Root component
│   ├── main.tsx                  # Entry point
│   ├── styles.css                # Global styles (dark theme, glassmorphism)
│   ├── state/store.ts            # Zustand store (all global state)
│   ├── canvas/
│   │   ├── Canvas.tsx            # Konva Stage + board-level drawing logic
│   │   ├── nodes.ts              # Node spawning + auto-tiling
│   │   ├── types.ts              # CanvasNode interfaces
│   │   ├── annotations/
│   │   │   ├── AnnotationOverlay.tsx  # SVG overlay for browser annotations
│   │   │   └── useAnnotations.ts      # Annotation state hook
│   │   └── nodes/
│   │       ├── BrowserNode.tsx   # Web browser node
│   │       ├── TerminalNode.tsx  # xterm terminal
│   │       ├── ShellNode.tsx     # Shell terminal
│   │       ├── NoteNode.tsx      # Yellow sticky note
│   │       ├── TextNode.tsx      # Large text block
│   │       └── ShapeNode.tsx     # Rectangle / ellipse
│   ├── ui/
│   │   ├── Navbar.tsx            # Toolbar + workspace switcher
│   │   ├── CommandBar.tsx        # Command bar (text + voice)
│   │   ├── PreviewDock.tsx       # Live preview panel + screenshot send-to-terminal
│   │   ├── backgrounds.tsx       # Animated backgrounds
│   │   ├── themes.ts             # Color themes
│   │   ├── SpotifyPlayer.tsx     # Spotify/YouTube/Apple Music embed player
│   │   └── voice.ts              # Whisper voice recognition
│   └── bridge/
│       ├── protocol.ts           # WebSocket message types
│       └── sidecar.ts            # WebSocket sidecar client
│
├── sidecar/                      # Node.js backend (PTY + agent runner)
│   └── src/
│       ├── index.ts              # WebSocket server
│       ├── terminals.ts          # PTY lifecycle management
│       └── ...
│
├── src-tauri/                    # Tauri shell (Rust)
│   ├── main.rs
│   ├── Info.plist                # macOS microphone privacy description
│   ├── binaries/                 # Built sidecar binaries for Tauri externalBin
│   ├── tauri-plugin-llm/         # Custom LLM plugin (SmolLM2)
│   └── tauri.conf.json
│
├── public/backgrounds/           # Animated background videos
└── docs/                         # Demo scripts
```

---

## 🎮 Quick start

| Action | How |
|---|---|
| **Add a terminal** | Click `+ CLI` in the navbar, pick an agent |
| **Set project folder** | Click `Project` in the navbar; terminals in that workspace reuse it |
| **Move / resize** | Drag a node, resize from its corners |
| **Add a browser** | Click the 🌐 button in the navbar |
| **Annotate a web page** | Click ✎ on the browser node, pick a tool (T / ↗ / ✎) |
| **Draw on the canvas** | Select pen or arrow in the navbar, drag to draw |
| **Erase drawings** | Select eraser in the navbar, brush over strokes |
| **Take notes** | 📝 (note) and **T** (text) buttons |
| **Switch workspaces** | Click the numbered squares left of the navbar |
| **Close workspaces** | Hover workspace 2+ and click `×` |
| **Quick command** | Type `/` in the command bar |
| **Voice** | Click the 🎤 mic button in the command bar |

Each workspace now owns one project folder. The first terminal in a blank
workspace asks for that folder, and later terminals reuse it. Enable
**Multi-folder on same project** in Settings only when every new CLI should ask
for a different folder. The media player is global, so playback continues while
switching workspaces. Settings also supports a per-workspace remote server URL
that can be opened in the preview dock.

### OHCANVAS commands (from a CLI agent)

An AI agent can manipulate the canvas by printing JSON commands to stdout:

```
OHCANVAS {"action":"open_browser","url":"http://localhost:3000"}
OHCANVAS {"action":"open_preview","url":"http://localhost:3000"}
OHCANVAS {"action":"run_shell","command":"pnpm dev"}
OHCANVAS {"action":"send_terminal","name":"Claude","input":"run the failing tests"}
OHCANVAS {"action":"broadcast_terminal","input":"check the current browser issue"}
OHCANVAS {"action":"spawn_agent","agentType":"codex","name":"Reviewer","task":"review this change","cwd":"/path/to/project"}
OHCANVAS {"action":"tile_windows"}
OHCANVAS {"action":"close_browsers"}
OHCANVAS {"action":"add_note","text":"Idea to explore"}
OHCANVAS {"action":"kill_terminal","terminalId":"term_abc123"}
OHCANVAS {"action":"focus_terminal","terminalId":"term_abc123"}
```

The bottom command bar can now hand orchestration to a real CLI, for example:
`chiedi a codex di coordinare claude e pi per sistemare il browser`. The selected
CLI receives a compact control prompt and can delegate work to the other live
terminals by emitting `OHCANVAS` lines.

Useful command bar examples:

```
manda a tutti: controllate il browser e proponete una fix
chiudi tutti i terminali tranne codex
apri localhost:5173 nel browser
apri preview localhost:5173
sistema le finestre
```

---

## ⚙️ Tech stack

| Layer | Technology |
|---|---|
| **Frontend** | React 18, TypeScript, Vite 6, Konva / react-konva, Zustand |
| **Terminals** | xterm.js + @lydell/node-pty |
| **Desktop** | Tauri 2 (Rust) |
| **Backend** | Node.js sidecar (WebSocket) |
| **Voice** | Whisper (native Tauri plugin) |
| **Local LLM** | SmolLM2 (custom Tauri plugin) |
| **Persistence** | Tauri file-backed state in `<app_data_dir>/state` with localStorage fallback |

---

## 🧪 Status — MVP

Initial working release. Upcoming roadmap:

- [x] Real PTY terminals (Pi, Claude Code, Codex, Cursor, Hermes, shell)
- [x] Browser, note, text, shape nodes
- [x] Board-level drawing (pen, arrow, eraser)
- [x] Browser annotations (pen, arrow, text)
- [x] Live preview with dev server detection
- [x] Whisper voice commands
- [x] Multiple workspaces
- [x] Media player (Spotify, YouTube Music, Apple Music)
- [x] Canvas control from CLI agent
- [x] Annotation selection and editing (post-commit) — select tool, delete via `Del`/`Backspace`/toolbar button, recolor, double-click text to edit
- [x] Performance with 10+ terminals — RAF-coalesced auto-tile, xterm scrollback 8000→3000, offscreen xterm-write culling via canvas viewport rect
- [x] File-based persistence (instead of localStorage) — `<app_data_dir>/state/<key>.json` via Tauri commands with atomic writes + localStorage migration on first read
- [x] Linux x86_64 build in CI (Tauri 2 webview deps + cmake/clang for llama.cpp + whisper.cpp)
- [x] Sidecar bundled as Tauri binary — Rust spawns `<resource_dir>/ohcanvas-sidecar[.exe]` (falls back to `pnpm --filter sidecar start` in dev); CI builds it per platform via `bun build --compile` and installs the matching `@lydell/node-pty-*` prebuild package for each target.
- [x] Auto-update artifacts in release builds (`latest-release.json` generated from uploaded bundles)
- [ ] macOS sidecar signing/notarization (Gatekeeper)

---

## 📄 License

MIT
