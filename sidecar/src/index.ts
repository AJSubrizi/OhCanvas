import { WebSocketServer, WebSocket } from "ws";
import http from "node:http";
import { Orchestrator } from "./orchestrator.ts";
import { SIDECAR_PORT, type ClientMsg, type ServerMsg } from "./protocol.ts";

const clients = new Set<WebSocket>();
const SPOTIFY_CALLBACK_PORT = 8788;

function broadcast(msg: ServerMsg) {
  const data = JSON.stringify(msg);
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(data);
  }
}

const orchestrator = new Orchestrator(broadcast);
const wss = new WebSocketServer({ host: "127.0.0.1", port: SIDECAR_PORT });
const callbackServer = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);
  if (url.pathname !== "/spotify/callback") {
    res.writeHead(404).end("Not found");
    return;
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (code && state) {
    broadcast({ type: "spotify_auth_callback", code, state });
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(successHtml);
    return;
  }

  res.writeHead(400, { "content-type": "text/html; charset=utf-8" }).end(errorHtml);
});

wss.on("listening", () => {
  console.log(`[sidecar] orchestrator listening on ws://127.0.0.1:${SIDECAR_PORT}`);
});

callbackServer.listen(SPOTIFY_CALLBACK_PORT, "127.0.0.1", () => {
  console.log(`[sidecar] spotify callback listening on http://127.0.0.1:${SPOTIFY_CALLBACK_PORT}/spotify/callback`);
});

wss.on("connection", (ws) => {
  clients.add(ws);
  ws.send(JSON.stringify({ type: "ready" } satisfies ServerMsg));

  ws.on("message", async (raw) => {
    let msg: ClientMsg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    try {
      await orchestrator.handle(msg);
    } catch (err) {
      console.error("[sidecar] handler error", err);
    }
  });

  ws.on("close", () => clients.delete(ws));
  ws.on("error", () => clients.delete(ws));
});

function shutdown() {
  console.log("[sidecar] shutting down");
  orchestrator.disposeAll();
  wss.close();
  callbackServer.close();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

const successHtml = `<!doctype html>
<meta charset="utf-8">
<title>Spotify connected</title>
<body style="font-family: system-ui; background: #0b0d12; color: #e5e7eb; padding: 32px;">
  <h1>Spotify connected</h1>
  <p>You can close this browser tab and return to OhCanvas.</p>
</body>`;

const errorHtml = `<!doctype html>
<meta charset="utf-8">
<title>Spotify login failed</title>
<body style="font-family: system-ui; background: #0b0d12; color: #e5e7eb; padding: 32px;">
  <h1>Spotify login failed</h1>
  <p>Missing authorization code. Return to OhCanvas and try again.</p>
</body>`;
