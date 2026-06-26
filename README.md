# 🎨 OhCanvas

**Infinite canvas with real terminals, browser nodes, drawing tools, and AI agent integration.**

OhCanvas is an open-source desktop app — an infinite whiteboard where you spawn PTY-backed terminals, browse the web inside canvas nodes, draw arrows and freehand marks, take notes, and control everything from a CLI agent. Built with **Tauri 2 + React + Konva**.

---

## ✨ Features (MVP)

### Canvas
| Feature | Stato |
|---|---|
| ✅ Pan & zoom infinito | |
| ✅ Workspaces multipli (stile Ubuntu) | contenuto e sfondo indipendenti |
| ✅ Temi colore (Midnight, Outrun, Aurora, Mono) | |
| ✅ Sfondi animati (7 video + copertina) | |

### Nodi
| Feature | Stato |
|---|---|
| ✅ Terminali reali (Pi, Claude Code, Codex, Cursor, Hermes, shell) | PTY via sidecar Node.js |
| ✅ Nodi Browser | iframe navigabili con annotation overlay (penna, freccia, testo) |
| ✅ Note gialle sticky + Blocchi di testo grandi | |
| ✅ Forme (rettangolo, ellisse) | |
| ✅ Ridimensionamento e selezione nodi | |

### Strumenti di disegno (board-level)
| Feature | Stato |
|---|---|
| ✅ Penna (tratto libero) sulla canvas | |
| ✅ Freccia (con punta, ombra) | |
| ✅ Gomma | cancellazione per segmento più vicino |
| ✅ Palette colori (4 preset) | |

### Browser annotation overlay
| Feature | Stato |
|---|---|
| ✅ Penna (tratto libero) sulla pagina web | |
| ✅ Freccia con punta sagomata | |
| ✅ Testo annotato | trascinabile, selezionabile |
| ✅ Palette colori (5 preset + custom picker) | |
| ✅ Invio screenshot annotato al terminale | come SVG via `@image` |

### Preview dock
| Feature | Stato |
|---|---|
| ✅ Rilevamento automatico dev server | |
| ✅ Preview responsive (mobile/desktop) | |
| ✅ Annotazioni anche nel dock | |

### Comandi vocali e AI
| Feature | Stato |
|---|---|
| ✅ Riconoscimento vocale (Whisper, plugin nativo Tauri) | |
| ✅ Modello LLM locale (SmolLM2, plugin Tauri custom) | |
| ✅ Controllo canvas da CLI agent | comandi `OHCANVAS` su stdout |
| ✅ Modello LLM configurabile (OpenAI, Anthropic, OpenRouter, Ollama…) | |

### Media player
| Feature | Stato |
|---|---|
| ✅ Spotify embed (login + ricerca playlist) | |
| ✅ YouTube Music embed | |
| ✅ Apple Music embed | |

---

## 🚀 Installazione

```bash
# Prerequisiti: Node 20+, pnpm 9+, Rust 1.77+, Xcode CLI Tools (macOS)

git clone https://github.com/subrizi/ohcanvas.git
cd ohcanvas
pnpm install

# Sviluppo (sidecar + finestra Tauri)
pnpm dev

# Solo frontend web (nessuna finestra Tauri)
pnpm dev:web

# Build per distribuzione
pnpm tauri build
```

> **Pi CLI**: per usare Pi, esegui `pi` una volta nel terminale per autenticarti.

---

## 🧱 Struttura progetto

```
ohcanvas/
├── src/                          # React + TypeScript frontend
│   ├── App.tsx                   # Root component
│   ├── main.tsx                  # Entry point
│   ├── styles.css                # Stili globali (tema scuro, glassmorphism)
│   ├── state/store.ts            # Zustand store (tutto lo stato globle)
│   ├── canvas/
│   │   ├── Canvas.tsx            # Stage Konva + logica di disegno (board-level)
│   │   ├── nodes.ts              # Spawn nodi + auto-tiling
│   │   ├── types.ts              # Interfacce CanvasNode
│   │   ├── annotations/
│   │   │   ├── AnnotationOverlay.tsx  # Overlay SVG per annotazioni browser
│   │   │   └── useAnnotations.ts      # Hook stato annotazioni
│   │   └── nodes/
│   │       ├── BrowserNode.tsx   # Nodo browser web
│   │       ├── TerminalNode.tsx  # Terminale xterm
│   │       ├── ShellNode.tsx     # Shell terminale
│   │       ├── NoteNode.tsx      # Nota sticky gialla
│   │       ├── TextNode.tsx      # Blocco testo grande
│   │       └── ShapeNode.tsx     # Rettangolo / ellisse
│   ├── ui/
│   │   ├── Navbar.tsx            # Toolbar + workspace switcher
│   │   ├── CommandBar.tsx        # Barra comandi (testo + voce)
│   │   ├── PreviewDock.tsx       # Pannello preview live
│   │   ├── backgrounds.tsx       # Sfondi animati
│   │   ├── themes.ts             # Temi colore
│   │   ├── media.tsx             # Player Spotify/YouTube/Apple Music
│   │   └── voice.ts              # Riconoscimento vocale Whisper
│   └── bridge/
│       ├── protocol.ts           # Tipi messaggi WebSocket
│       └── sidecar.ts            # Client WebSocket sidecar
│
├── sidecar/                      # Backend Node.js (PTY + agent runner)
│   └── src/
│       ├── index.ts              # Server WebSocket
│       ├── terminals.ts          # Gestione ciclo vita PTY
│       └── ...
│
├── src-tauri/                    # Shell Tauri (Rust)
│   ├── main.rs
│   ├── tauri-plugin-llm/         # Plugin LLM custom (SmolLM2)
│   └── tauri.conf.json
│
├── public/backgrounds/           # Video sfondo animati
└── docs/                         # Script demo
```

---

## 🎮 Utilizzo rapido

| Azione | Come fare |
|---|---|
| **Aggiungere un terminale** | Click `+ CLI` nella navbar, scegli un agente |
| **Muovere / ridimensionare** | Trascina un nodo, ridimensiona dagli angoli |
| **Aggiungere un browser** | Click pulsante 🌐 nella navbar |
| **Annotare una pagina web** | Click ✎ sul browser node, scegli strumento (T / ↗ / ✎) |
| **Disegnare sulla canvas** | Seleziona penna o freccia nella navbar, trascina |
| **Cancellare disegni** | Gomma nella navbar, passa sopra i tratti |
| **Prendere appunti** | 📝 (nota) e **T** (testo) |
| **Cambiare workspace** | Click quadrati numerati a sinistra della navbar |
| **Comando rapido** | Scrivi `/` nella command bar |
| **Voce** | Click 🎤 nella command bar |

### Comandi OHCANVAS (da un agente CLI)

Un agente AI può manipolare la canvas stampando comandi JSON su stdout:

```
OHCANVAS {"action":"open_browser","url":"http://localhost:3000"}
OHCANVAS {"action":"run_shell","command":"pnpm dev"}
OHCANVAS {"action":"add_note","text":"Idea da esplorare"}
OHCANVAS {"action":"kill_terminal"}
OHCANVAS {"action":"focus_terminal"}
```

---

## ⚙️ Tech stack

| Layer | Tecnologia |
|---|---|
| **Frontend** | React 18, TypeScript, Vite 6, Konva / react-konva, Zustand |
| **Terminali** | xterm.js + @lydell/node-pty |
| **Desktop** | Tauri 2 (Rust) |
| **Backend** | Node.js sidecar (WebSocket) |
| **Voce** | Whisper (plugin nativo Tauri) |
| **LLM locale** | SmolLM2 (plugin Tauri custom) |

---

## 🧪 Stato — MVP

Prima release funzionante. La roadmap prossime iterazioni:

- [x] Terminali PTY reali (Pi, Claude Code, Codex, Cursor, Hermes, shell)
- [x] Nodi browser, nota, testo, forma
- [x] Disegno board-level (penna, freccia, gomma)
- [x] Annotazioni browser (penna, freccia, testo)
- [x] Preview live con rilevamento dev server
- [x] Comandi vocali Whisper
- [x] Workspace multipli
- [x] Player multimediale (Spotify, YouTube Music, Apple Music)
- [x] Controllo canvas da CLI agent
- [ ] Prestazioni con 10+ terminali
- [ ] Persistenza su file (invece di localStorage)
- [ ] Sidecar come binario Tauri
- [ ] Build Windows / Linux
- [ ] Selezione e modifica annotazioni (dopo il commit)

---

## 📄 Licenza

MIT
