# 🎨 OhCanvas

**Infinite canvas with real terminals, browser nodes, drawing tools, and AI agent integration.** 

OhCanvas is an open-source desktop app — an infinite whiteboard where you spawn PTY-backed terminals, browse the web inside canvas nodes, draw arrows and freehand marks, take notes, and control everything from a CLI agent. Built with **Tauri 2 + React + Konva**.

---

## 🚀 Installation

```bash
# Prerequisites: Node 20+, pnpm 9+, Rust 1.77+, Xcode CLI Tools (macOS)

git clone https://github.com/subrizi/ohcanvas.git
cd ohcanvas
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
│   │   ├── PreviewDock.tsx       # Live preview panel
│   │   ├── backgrounds.tsx       # Animated backgrounds
│   │   ├── themes.ts             # Color themes
│   │   ├── media.tsx             # Spotify/YouTube/Apple Music player
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
| **Move / resize** | Drag a node, resize from its corners |
| **Add a browser** | Click the 🌐 button in the navbar |
| **Annotate a web page** | Click ✎ on the browser node, pick a tool (T / ↗ / ✎) |
| **Draw on the canvas** | Select pen or arrow in the navbar, drag to draw |
| **Erase drawings** | Select eraser in the navbar, brush over strokes |
| **Take notes** | 📝 (note) and **T** (text) buttons |
| **Switch workspaces** | Click the numbered squares left of the navbar |
| **Quick command** | Type `/` in the command bar |
| **Voice** | Click the 🎤 mic button in the command bar |

### OHCANVAS commands (from a CLI agent)

An AI agent can manipulate the canvas by printing JSON commands to stdout:

```
OHCANVAS {"action":"open_browser","url":"http://localhost:3000"}
OHCANVAS {"action":"run_shell","command":"pnpm dev"}
OHCANVAS {"action":"add_note","text":"Idea to explore"}
OHCANVAS {"action":"kill_terminal"}
OHCANVAS {"action":"focus_terminal"}
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
- [ ] Performance with 10+ terminals
- [ ] File-based persistence (instead of localStorage)
- [ ] Sidecar bundled as Tauri binary
- [ ] Windows / Linux builds
- [ ] Annotation selection and editing (post-commit)

---

## 📄 License

MIT
