# OhCanvas v0.1 Demo Script

## Setup

Run:

```bash
pnpm run dev:web
```

Open the app.

## Demo Flow

1. Use the command bar:

```text
spawn a codex agent
```

2. Ask the Codex card:

```text
Create a tiny landing page in this workspace, run it with a dev server, and open the browser preview on the canvas. When you need canvas control, print OHCANVAS lines.
```

3. Expected agent behavior:

```text
OHCANVAS {"action":"run_shell","command":"pnpm dev"}
OHCANVAS {"action":"open_browser","url":"http://localhost:3000"}
OHCANVAS {"action":"add_note","text":"Preview is running. Next step: polish the hero."}
```

4. Ask follow-up:

```text
Make the browser result more premium and add a note with the changes you made.
```

5. Expected visible result:

- Shell card streams the dev server.
- Browser card shows the running app.
- Agent card logs useful progress.
- Note card appears with the summary.
