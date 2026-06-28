import { useEffect, useRef, useState } from "react";
import {
  retileTerminalsIfAuto,
  selectTerminalNode,
  spawnBrowserNode,
  spawnNoteNode,
  spawnTextNode,
  tileTerminals,
} from "../canvas/nodes";
import { sidecar } from "../bridge/sidecar";
import { useCanvasStore } from "../state/store";
import { labelForCli, parseCliKind } from "./cliOptions";
import { pickFolder } from "./workspacePicker";
import { activeWorkspaceProject, resolveTerminalFolder } from "./projectFolders";
import { onVoiceFinal, startVoice, stopVoice, voiceSupported } from "./voice";
import { CONDUCTOR_ID, type TerminalKind } from "../bridge/protocol";

const HINTS = [
  'Ask: "chiudi tutti i terminali"',
  'Ask: "apri localhost:3000 nel browser"',
  'Ask: "apri codex in questa cartella"',
  'Ask: "chiedi a codex di coordinare claude e pi"',
  "Cmd+K assistant · Cmd+Shift+T tile · Cmd+Shift+B browser",
];

const STOPWORDS = new Set([
  "on", "in", "the", "a", "an", "su", "sul", "sulla", "nel", "nella", "il", "lo", "la",
  "di", "del", "della", "to", "into", "your", "my", "tua", "mia",
]);

interface FolderCtx {
  terminals: Record<string, { title?: string; cwd?: string; running?: boolean }>;
}

const basename = (p: string) => p.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || p;

/**
 * Resolve a folder from natural language, returning a ~-relative path the sidecar
 * can expand. Handles e.g. "in ~/Code/app", "on the desktop called P",
 * "nella cartella P sulla scrivania", "same folder as Vale".
 */
function parseFolder(text: string, ctx: FolderCtx): { path: string; name: string } | null {
  // "same folder as Vale" / "stessa cartella di Vale" / "next to Vale" / "where Vale is".
  const sameAs = text.match(
    /\b(?:same (?:folder|dir|directory)\s+as|in the same (?:folder|dir)\s+as|stessa cartella (?:di|come|d')\s*|next to|accanto a|dove (?:sta|lavora)|where(?:'s| is)?)\s+["']?([\w-]+)/i,
  );
  if (sameAs) {
    const who = sameAs[1].toLowerCase();
    const term = Object.values(ctx.terminals).find(
      (t) => t.cwd && (t.title || "").toLowerCase().split(/[ ·]/)[0] === who,
    );
    if (term?.cwd) return { path: term.cwd, name: basename(term.cwd) };
  }

  const explicit = text.match(/(?:^|\s)(~\/[^\s]+|\/[A-Za-z0-9._/\-]+)/);
  if (explicit) {
    const p = explicit[1].replace(/[.,;]+$/, "");
    return { path: p, name: basename(p) };
  }

  let base: string | null = null;
  if (/\b(desktop|scrivania)\b/i.test(text)) base = "~/Desktop";
  else if (/\b(documents|documenti)\b/i.test(text)) base = "~/Documents";
  else if (/\b(downloads?|scaricat[io])\b/i.test(text)) base = "~/Downloads";

  const called = text.match(/\b(?:called|named|chiamat[ao])\s+["']?([\w.\-]+)["']?/i);
  const folderWord = text.match(/\b(?:folder|cartella|directory|dir)\s+["']?([\w.\-]+)["']?/i);
  let name = called?.[1] ?? folderWord?.[1];
  if (name && STOPWORDS.has(name.toLowerCase())) name = undefined;

  if (base && name) return { path: `${base}/${name}`, name };
  if (base) return { path: base, name: basename(base) };
  if (name) return { path: `~/${name}`, name };
  return null;
}

/**
 * Decide whether "<cli> …" means "spawn a new CLI" (vs route a message to an
 * existing one). Spawn when there's an open verb, a folder, or it's basically a
 * bare CLI name. Returns the resolved cwd/folder or null to skip spawning.
 */
function parseSpawnIntent(text: string, ctx: FolderCtx): { cwd?: string; folderName?: string } | null {
  const lower = text.toLowerCase();
  const folder = parseFolder(text, ctx);
  const hasOpenVerb = /\b(open|apri|apre|spawn|launch|new|nuov[oa]|crea|avvia|start|run|lancia)\b/i.test(lower);

  const cliAlias = /\b(pi|pai|piai|codex|openai|claude|cloud|cursor|hermes|ermes|shell)\b/gi;
  const fillers = /\b(open|apri|apre|spawn|launch|new|nuov[oa]|crea|avvia|start|run|lancia|terminal|terminale|cli|agent|agente|the|a|an|il|lo|la|un|una|please|per|favore|in|into|nel|nella|su|sul|sulla|folder|cartella|on|desktop|scrivania|documents|documenti|downloads?|called|named|chiamat[ao]|code)\b/gi;
  const stripped = lower.replace(cliAlias, " ").replace(fillers, " ").replace(/[^a-z0-9]/g, "").trim();
  const isBareIsh = stripped.length <= 2;

  if (folder || hasOpenVerb || isBareIsh) {
    return { cwd: folder?.path, folderName: folder?.name };
  }
  return null;
}

/** Map a spoken noun ("agent", "terminale", "claude") to a concrete terminal kind. */
function cliKindForNoun(noun: string): TerminalKind {
  const n = noun.toLowerCase();
  const k = parseCliKind(n);
  if (k) return k;
  if (/agent|agente|agenti/.test(n)) return "pi";
  return "shell"; // bare "terminal/terminale" → plain shell window
}

const NUM_WORDS: Record<string, number> = {
  due: 2, two: 2, tre: 3, three: 3, quattro: 4, four: 4,
  cinque: 5, five: 5, sei: 6, six: 6, "un paio": 2, "a couple": 2,
};

/**
 * Handle commands that spawn *several* windows at once, e.g.
 *   "apri tre terminali", "open two claude", "crea 4 agenti sulla scrivania",
 *   "apri claude e codex", "open claude, cursor and pi".
 * Returns a status string when it spawned, or null to fall through to the
 * single-command parser.
 */
async function tryMultiSpawn(text: string, ctx: FolderCtx): Promise<string | null> {
  const lower = text.toLowerCase();

  // A) Count-based: "<verb> <N> <noun>"
  const countMatch = lower.match(
    /\b(?:open|apri|apre|spawn|launch|crea|avvia|start|new|nuov[oa]|lancia|aprimi|dammi)\s+(\d+|due|two|tre|three|quattro|four|cinque|five|sei|six|un paio|a couple)\s+(?:of\s+)?(terminals?|terminali|terminale|cli|agents?|agenti|shells?|claude|codex|cursor|pi|hermes|browsers?|previews?)\b/i,
  );
  if (countMatch) {
    const raw = countMatch[1].toLowerCase();
    let n = /^\d+$/.test(raw) ? parseInt(raw, 10) : (NUM_WORDS[raw] ?? 2);
    n = Math.min(Math.max(n, 1), 8); // cap to keep the canvas sane
    const noun = countMatch[2].toLowerCase();
    if (/browser|preview/.test(noun)) {
      for (let i = 0; i < n; i += 1) spawnBrowserNode();
      return `Opened ${n} browser preview${n === 1 ? "" : "s"}`;
    }
    const folder = parseFolder(text, ctx) ?? activeWorkspaceProject() ?? await resolveTerminalFolder();
    if (!folder) return "Folder cancelled";
    const kind = cliKindForNoun(noun);
    const label = labelForCli(kind);
    for (let i = 0; i < n; i += 1) {
      sidecar.startTerminal({
        kind,
        cwd: folder.path ?? undefined,
        title: folder?.name ? `${label} · ${folder.name}` : undefined,
      });
    }
    return `Opened ${n} ${label} terminal${n === 1 ? "" : "s"}${folder ? ` in ${folder.name}` : ""}`;
  }

  // B) Conjunction-based: "<verb> claude e codex (e cursor)". Require an explicit
  // open verb so "manda a claude e codex: ..." (route a message) isn't hijacked.
  const cliRe = /\b(pi|pai|codex|openai|claude|cloud|cursor|hermes|ermes|shell)\b/gi;
  const names = lower.match(cliRe) || [];
  const hasOpenVerb = /\b(open|apri|apre|spawn|launch|crea|avvia|start|new|nuov[oa]|lancia)\b/i.test(lower);
  const hasSeparator = /(?:\s(?:e|and|poi|then|plus|più)\s|,|&|\+)/i.test(lower);
  if (names.length >= 2 && hasOpenVerb && hasSeparator) {
    const folder = parseFolder(text, ctx) ?? activeWorkspaceProject() ?? await resolveTerminalFolder();
    if (!folder) return "Folder cancelled";
    const segments = text.split(/\s*(?:,|&|\+|\b(?:e|and|poi|then|plus|più)\b)\s*/i);
    const spawned: string[] = [];
    for (const seg of segments) {
      const resolved: TerminalKind | null =
        parseCliKind(seg) ?? (/\bshell\b/i.test(seg) ? "shell" : null);
      if (!resolved) continue;
      sidecar.startTerminal({
        kind: resolved,
        cwd: folder.path ?? undefined,
        title: folder?.name ? `${labelForCli(resolved)} · ${folder.name}` : undefined,
      });
      spawned.push(labelForCli(resolved));
    }
    if (spawned.length >= 2) {
      return `Opened ${spawned.join(", ")}${folder ? ` in ${folder.name}` : ""}`;
    }
  }

  return null;
}

type TerminalRuntimeView = {
  kind: TerminalKind;
  title?: string;
  cwd?: string;
  running?: boolean;
};

type TerminalMap = Record<string, TerminalRuntimeView>;

const ORCHESTRATOR_KINDS = new Set<TerminalKind>(["codex", "claude-code", "pi", "cursor", "hermes"]);

function activeTerminals(terminals: TerminalMap) {
  return Object.entries(terminals).filter(([, runtime]) => runtime.running);
}

function firstRunningTerminalByKind(terminals: TerminalMap, kind: TerminalKind) {
  return activeTerminals(terminals).find(([, runtime]) => runtime.kind === kind) ?? null;
}

function terminalDisplayName(id: string, runtime: TerminalRuntimeView) {
  return runtime.title || labelForCli(runtime.kind) || id;
}

function findRunningTerminalByKind(terminals: TerminalMap, kind: TerminalKind) {
  const match = firstRunningTerminalByKind(terminals, kind);
  return match ? { id: match[0], runtime: match[1] } : null;
}

function findRunningTerminalByTitle(terminals: TerminalMap, name: string) {
  const wanted = name.toLowerCase().trim();
  const match = activeTerminals(terminals).find(([id, runtime]) => {
    const title = (runtime.title || "").toLowerCase();
    const first = title.split(/[ ·-]/)[0];
    return id.toLowerCase() === wanted || title === wanted || first === wanted || title.includes(wanted);
  });
  return match ? { id: match[0], runtime: match[1] } : null;
}

function mentionsMultipleCliActors(text: string, terminals: TerminalMap) {
  const l = text.toLowerCase();
  const mentionedKinds = new Set<TerminalKind>();
  for (const kind of ["pi", "codex", "claude-code", "cursor", "hermes"] as TerminalKind[]) {
    const label = labelForCli(kind).toLowerCase();
    if (l.includes(label) || (kind === "claude-code" && /\b(cloud|claude)\b/i.test(l))) {
      mentionedKinds.add(kind);
    }
  }
  let mentionedTitles = 0;
  for (const [, runtime] of activeTerminals(terminals)) {
    const title = (runtime.title || "").toLowerCase();
    const first = title.split(/[ ·-]/)[0];
    if (first && first.length > 2 && l.includes(first)) mentionedTitles += 1;
  }
  return mentionedKinds.size + mentionedTitles >= 2;
}

function wantsAgentOrchestration(text: string, targetKind: TerminalKind, terminals: TerminalMap) {
  if (!ORCHESTRATOR_KINDS.has(targetKind)) return false;
  const mentionsTeamScope =
    /\b(altr[ei]|other|another|team|squadra|agenti|agents|cli|terminali|terminals)\b/i.test(text);
  const mentionsCoordination =
    /\b(orchestra|orchestrate|coordina|coordinate|comanda|control|delegate|delega|supervisiona|gestisci|manage)\b/i.test(text);
  const mentionsMultipleActors = mentionsMultipleCliActors(text, terminals);

  return mentionsMultipleActors || mentionsCoordination || mentionsTeamScope;
}

function stripOrchestratorLead(text: string, targetKind: TerminalKind) {
  const targetWords =
    targetKind === "claude-code" ? "(?:claude|cloud|claude code)" :
    targetKind === "pi" ? "(?:pi|pai|piai)" :
    targetKind === "codex" ? "(?:codex|openai)" :
    targetKind === "hermes" ? "(?:hermes|ermes|ermès)" :
    "(?:cursor)";
  const re = new RegExp(
    String.raw`^\s*(?:ask|tell|prompt|send to|manda a|chiedi a|di(?:'|ci)? a|usa|use)\s+${targetWords}\s*(?:di|to|per|:|-)?\s*`,
    "i",
  );
  return text.replace(re, "").trim() || text.trim();
}

function buildCliOrchestrationPrompt(
  userText: string,
  targetId: string,
  targetRuntime: TerminalRuntimeView,
  terminals: TerminalMap,
  flowNodes: Array<{ id: string; type?: string | null; data?: unknown }>,
) {
  const roster = activeTerminals(terminals)
    .map(([id, runtime], index) => {
      const selected = flowNodes.some((node) => {
        const data = node.data as Record<string, unknown> | undefined;
        return Boolean((data?.terminalId === id || node.id === id) && (node as any).selected);
      });
      const role = id === targetId ? "you/orchestrator" : "available worker";
      return [
        `${index + 1}. ${terminalDisplayName(id, runtime)} (${labelForCli(runtime.kind)})`,
        `id=${id}`,
        `role=${role}`,
        runtime.cwd ? `cwd=${runtime.cwd}` : "cwd=unknown",
        selected ? "selected=true" : "",
      ].filter(Boolean).join(" | ");
    })
    .join("\n");

  const task = stripOrchestratorLead(userText, targetRuntime.kind);
  return [
    "You are controlling OhCanvas from this real CLI terminal.",
    "You can coordinate the other CLI terminals by printing OHCANVAS control lines.",
    "Important: when you want OhCanvas to act, print a single compact JSON line prefixed with OHCANVAS. No markdown fences.",
    "",
    "Available actions:",
    'OHCANVAS {"action":"send_terminal","terminalId":"term_id","input":"message or command for that CLI"}',
    'OHCANVAS {"action":"send_terminal","name":"Claude","input":"message or command for that CLI"}',
    'OHCANVAS {"action":"open_browser","url":"http://localhost:3000"}',
    'OHCANVAS {"action":"open_preview","url":"http://localhost:3000"}',
    'OHCANVAS {"action":"run_shell","command":"pnpm test","cwd":"/path/to/project"}',
    'OHCANVAS {"action":"spawn_agent","agentType":"codex","name":"Reviewer","task":"review the change","cwd":"/path/to/project"}',
    'OHCANVAS {"action":"broadcast_terminal","input":"short instruction for every CLI"}',
    'OHCANVAS {"action":"tile_windows"}',
    'OHCANVAS {"action":"close_browsers"}',
    'OHCANVAS {"action":"add_note","text":"short status note"}',
    "",
    "Terminals:",
    roster || "No other terminals are open yet.",
    "",
    "Rules:",
    "- Prefer terminalId over name when delegating.",
    "- If you delegate to another terminal, include enough context for that CLI to act.",
    "- Do not claim you have delegated unless you printed the OHCANVAS send_terminal line.",
    "- After delegating, briefly summarize what you sent.",
    "",
    "User order:",
    task,
  ].join("\n");
}

function tryOrchestrateViaCli(text: string, terminals: TerminalMap, flowNodes: any[]): string | null {
  const targetKind = parseCliKind(text);
  if (!targetKind || !wantsAgentOrchestration(text, targetKind, terminals)) return null;

  const existing = firstRunningTerminalByKind(terminals, targetKind);
  const label = labelForCli(targetKind);
  if (existing) {
    const [terminalId, runtime] = existing;
    const prompt = buildCliOrchestrationPrompt(text, terminalId, runtime, terminals, flowNodes);
    sidecar.writeTerminal(terminalId, `${prompt}\r`);
    selectTerminalNode(terminalId);
    return `Asked ${label} to coordinate the CLI team`;
  }

  const folder = parseFolder(text, { terminals }) ?? activeWorkspaceProject();
  const terminalId = `${targetKind}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  const runtime: TerminalRuntimeView = {
    kind: targetKind,
    title: label,
    cwd: folder?.path ?? undefined,
    running: true,
  };
  const prompt = buildCliOrchestrationPrompt(text, terminalId, runtime, terminals, flowNodes);
  sidecar.startTerminal({
    terminalId,
    kind: targetKind,
    cwd: folder?.path ?? undefined,
    title: folder?.name ? `${label} · ${folder.name}` : label,
    initialInput: prompt,
  });
  return `Opened ${label} as orchestrator`;
}

function tryBroadcastToTerminals(text: string, terminals: TerminalMap): string | null {
  const match = text.match(
    /^(?:broadcast|manda a tutti|manda agli agenti|send to all|tell all|di a tutti|scrivi a tutti)(?:\s+(?:i\s+)?(?:terminali|agents?|agenti|cli))?\s*[:\-]?\s*(.+)$/i,
  );
  if (!match) return null;
  const input = match[1].trim();
  if (!input) return null;
  const targets = activeTerminals(terminals);
  for (const [id] of targets) sidecar.writeTerminal(id, `${input}\r`);
  useCanvasStore.getState().pushCanvasActivity(`Broadcast to ${targets.length} terminal${targets.length === 1 ? "" : "s"}`);
  return targets.length
    ? `Sent to ${targets.length} terminal${targets.length === 1 ? "" : "s"}`
    : "No terminals to broadcast to";
}

function isTerminalNode(node: { type?: string | null }) {
  return node.type === "terminal" || node.type === "shell";
}

function isBrowserNode(node: { type?: string | null }) {
  return node.type === "browser";
}

async function closeTerminalWindows(exceptTerminalId?: string | null) {
  const store = useCanvasStore.getState();
  const terminalIds = new Set<string>();

  Object.keys(store.terminals).forEach((id) => {
    if (id !== exceptTerminalId) terminalIds.add(id);
  });
  store.flowNodes.forEach((node: any) => {
    if (!isTerminalNode(node)) return;
    const data = node.data as Record<string, unknown> | undefined;
    const id = String(data?.terminalId ?? data?.shellId ?? node.id);
    if (id && id !== exceptTerminalId) terminalIds.add(id);
  });

  terminalIds.forEach((id) => sidecar.killTerminal(id));
  store.setFlowNodes(
    store.flowNodes.filter((node) => {
      if (!isTerminalNode(node)) return true;
      const data = node.data as Record<string, unknown> | undefined;
      const id = String(data?.terminalId ?? data?.shellId ?? node.id);
      return id === exceptTerminalId;
    }),
  );
  retileTerminalsIfAuto();
  store.pushCanvasActivity(
    terminalIds.size ? `Closed ${terminalIds.size} terminal${terminalIds.size === 1 ? "" : "s"}` : "No terminals to close",
  );
  return terminalIds.size;
}

async function closeBrowserWindows() {
  const store = useCanvasStore.getState();
  const count = store.flowNodes.filter(isBrowserNode).length;
  store.setFlowNodes(store.flowNodes.filter((node) => !isBrowserNode(node)));
  retileTerminalsIfAuto();
  store.pushCanvasActivity(count ? `Closed ${count} browser preview${count === 1 ? "" : "s"}` : "No browser previews to close");
  return count;
}

/**
 * Fast local intent parser. Returns a status string when it handles the command
 * locally, or null to hand off to the conductor (the LLM brain).
 */
async function run(text: string): Promise<string | null> {
  const t = text.trim();
  if (!t) return null;
  const lower = t.toLowerCase();

  const terminals = useCanvasStore.getState().terminals;
  const flowNodes = useCanvasStore.getState().flowNodes;
  const folderCtx: FolderCtx = {
    terminals,
  };
  // Multi-window spawns ("apri tre terminali", "open claude e codex") before the
  // single-command handlers, so counts/conjunctions aren't swallowed as one CLI.
  const multi = await tryMultiSpawn(t, folderCtx);
  if (multi) return multi;

  const broadcast = tryBroadcastToTerminals(t, terminals);
  if (broadcast) return broadcast;

  const orchestrated = tryOrchestrateViaCli(t, terminals, flowNodes);
  if (orchestrated) return orchestrated;

  const wantsAll = /\b(all|every|tutti|tutte|ogni)\b/i.test(lower);
  const wantsClose = /\b(close|kill|stop|exit|chiudi|chiudere|uccidi|ferma|termina)\b/i.test(lower);
  const mentionsTerminal = /\b(terminals?|terminali|cli|agents?|agenti)\b/i.test(lower);
  const mentionsBrowser = /\b(browsers?|preview|previews|browser|anteprime?|finestre browser)\b/i.test(lower);

  const exceptMatch = t.match(
    /\b(?:close|kill|stop|chiudi|ferma|termina)\s+(?:all|tutti|tutte|ogni|everything|tutto)\s+(?:terminali|terminals?|cli|agents?|agenti)?\s*(?:except|tranne|salvo|eccetto)\s+([\w .-]+)/i,
  );
  if (exceptMatch) {
    const ref = exceptMatch[1].trim();
    const kind = parseCliKind(ref);
    const target = kind ? findRunningTerminalByKind(terminals, kind) : findRunningTerminalByTitle(terminals, ref);
    const count = await closeTerminalWindows(target?.id);
    return target
      ? `Closed ${count} terminal${count === 1 ? "" : "s"}, kept ${terminalDisplayName(target.id, target.runtime)}`
      : `Closed ${count} terminal${count === 1 ? "" : "s"}`;
  }

  if (wantsClose && wantsAll && mentionsTerminal) {
    const count = await closeTerminalWindows();
    return count ? `Closed ${count} terminal${count === 1 ? "" : "s"}` : "No terminals to close";
  }

  if (wantsClose && wantsAll && mentionsBrowser) {
    const count = await closeBrowserWindows();
    return count ? `Closed ${count} browser preview${count === 1 ? "" : "s"}` : "No browser previews to close";
  }

  if (
    /\b(remote|server|production|prod|remot[oa])\b/i.test(lower) &&
    /\b(open|apri|preview|anteprima|mostra)\b/i.test(lower)
  ) {
    const state = useCanvasStore.getState();
    const active = state.workspaces.find((ws) => ws.id === state.activeWorkspaceId);
    const remoteUrl = active?.remoteUrl?.trim();
    if (!remoteUrl) return "No remote server set for this workspace";
    const normalized = /^https?:\/\//i.test(remoteUrl) ? remoteUrl : `https://${remoteUrl}`;
    state.openPreview(normalized);
    state.pushCanvasActivity(`Opened remote preview ${normalized}`);
    return `Opened remote preview ${normalized}`;
  }

  const urlMatch = t.match(
    /(?:open|apri|browse)\s+(?:to\s+)?(https?:\/\/\S+|localhost(?::\d+)?\S*|\d+\.\d+\.\d+\.\d+\S*|[\w-]+\.\w{2,}\S*)/i,
  );
  const wantsBrowser = /\b(browser|browse|preview|anteprima|web|pagina|finestra browser)\b/i.test(lower);
  const wantsPreviewDock = /\b(preview|anteprima|dock)\b/i.test(lower) && !/\b(browser|finestra browser)\b/i.test(lower);
  if (urlMatch && wantsPreviewDock) {
    const url = normalizeBrowserUrl(urlMatch[1]);
    useCanvasStore.getState().openPreview(url);
    useCanvasStore.getState().pushCanvasActivity(`Opened preview ${url}`);
    return `Opened preview ${url}`;
  }

  if (urlMatch && (wantsBrowser || /localhost|http|\./i.test(lower))) {
    const url = normalizeBrowserUrl(urlMatch[1]);
    spawnBrowserNode(url);
    useCanvasStore.getState().pushCanvasActivity(`Opened browser ${url}`);
    return `Opened browser ${url}`;
  }

  if (wantsBrowser && /\b(apri|apre|open|spawn|new|nuovo|nuova|crea|mostra)\b/i.test(lower)) {
    spawnBrowserNode();
    useCanvasStore.getState().pushCanvasActivity("Opened browser preview");
    return "Opened browser preview";
  }

  // A CLI name (claude / hermes / codex / cursor / pi) — "open claude",
  // "hermes", or "open claude in the folder on the desktop called P".
  const cliKind = parseCliKind(t);
  if (cliKind) {
    const spawn = parseSpawnIntent(t, folderCtx);
    if (spawn) {
      let cwd = spawn.cwd;
      let folderLabel = spawn.folderName;
      // Explicit "pick/choose a folder" → open the native picker.
      if (
        !cwd &&
        /\b(pick|choose|select|scegli|seleziona)\b/i.test(lower) &&
        /\b(folder|cartella|directory)\b/i.test(lower)
      ) {
        const folder = await pickFolder();
        if (!folder) return "Folder cancelled";
        cwd = folder.path ?? undefined;
        folderLabel = folder.name;
      }
      if (!cwd) {
        const folder = await resolveTerminalFolder();
        if (!folder) return "Folder cancelled";
        cwd = folder.path ?? undefined;
        folderLabel = folder.name;
      }
      sidecar.startTerminal({
        kind: cliKind,
        cwd,
        title: folderLabel ? `${labelForCli(cliKind)} · ${folderLabel}` : labelForCli(cliKind),
      });
      return cwd
        ? `Opened ${labelForCli(cliKind)} in ${folderLabel ?? cwd}`
        : `Opened ${labelForCli(cliKind)}`;
    }
  }

  const noteMatch = t.match(/^(?:note|nota)\s+(.+)/i);
  if (noteMatch) {
    spawnNoteNode(noteMatch[1]);
    return "Added note";
  }

  const textMatch = t.match(/^(?:text|label|titolo)\s+(.+)/i);
  if (textMatch) {
    spawnTextNode(textMatch[1]);
    return "Added text";
  }

  const shellMatch = t.match(/^(?:run|shell|terminale)\s+(.+)/i);
  if (shellMatch) {
    const folder = await resolveTerminalFolder();
    if (!folder) return "Folder cancelled";
    sidecar.startTerminal({
      kind: "shell",
      command: shellMatch[1],
      cwd: folder.path ?? undefined,
      title: `Shell · ${folder.name}`,
    });
    return `Opened shell in ${folder.name}`;
  }

  // Quick global voice commands
  if (/\b(clear|reset|wipe)\s*(canvas|all|everything)?\b/i.test(lower)) {
    Object.keys(terminals).forEach((id) => sidecar.killTerminal(id));
    useCanvasStore.getState().clearCanvas();
    return "Canvas cleared";
  }

  // --- Enhanced terminal targeting and management for voice ---

  // Find a target terminal by explicit kind/name/title from the spoken text.
  // Do not silently fall back to the first/selected terminal: generic assistant
  // requests must go to the conductor router, not into an arbitrary CLI.
  const findTargetTerminal = (text: string): { id: string; runtime: any } | null => {
    const l = text.toLowerCase();
    const kinds: Record<string, string> = {
      pi: "pi",
      claude: "claude-code",
      "claude code": "claude-code",
      codex: "codex",
      cursor: "cursor",
      shell: "shell",
    };

    const runningList = Object.entries(terminals).filter(([, r]) => r.running);

    // "first", "last" helpers
    if (/\bfirst\b/.test(l) && runningList.length > 0) {
      const [id, runtime] = runningList[0];
      return { id, runtime };
    }
    if (/\b(last|latest)\b/.test(l) && runningList.length > 0) {
      const [id, runtime] = runningList[runningList.length - 1];
      return { id, runtime };
    }

    if (/\b(main|primary|important)\b/.test(l) && runningList.length > 0) {
      const pi = runningList.find(([, r]) => r.kind === "pi");
      if (pi) return { id: pi[0], runtime: pi[1] };
      return { id: runningList[0][0], runtime: runningList[0][1] };
    }

    for (const [key, kind] of Object.entries(kinds)) {
      if (l.includes(key)) {
        const match = Object.entries(terminals).find(
          ([, r]) => r.kind === kind && r.running,
        );
        if (match) return { id: match[0], runtime: match[1] };
      }
    }

    // Try by title words
    for (const [id, r] of Object.entries(terminals)) {
      if (!r.running) continue;
      const title = (r.title || "").toLowerCase();
      if (title && l.includes(title.split(" ")[0])) {
        return { id, runtime: r };
      }
    }

    // Support "terminal 1", "the 2nd", "number 3"
    const numMatch = l.match(/(?:terminal|the|number)\s*(\d+)/);
    if (numMatch) {
      const idx = parseInt(numMatch[1], 10) - 1;
      if (idx >= 0 && idx < runningList.length) {
        const [id, runtime] = runningList[idx];
        return { id, runtime };
      }
    }

    // Explicitly selected terminal, only when the user says selected/current.
    const selectedNode = flowNodes.find((n: any) => n.selected);
    if (
      /\b(selected|current|active|selezionat[oa]|corrente|attiv[oa])\b/.test(l) &&
      selectedNode &&
      (selectedNode.type === "terminal" || selectedNode.type === "shell")
    ) {
      const d = selectedNode.data as any;
      const tid = d.terminalId || d.shellId;
      if (tid && terminals[tid]) return { id: tid, runtime: terminals[tid] };
    }

    return null;
  };

  // Global terminal management (no specific target needed)
  if (/\b(tile|arrange|layout|organize|tidy|griglia|organizza|riordina|sistema)\b/i.test(lower)) {
    tileTerminals();
    useCanvasStore.getState().pushCanvasActivity("Arranged windows");
    return "Arranged windows";
  }
  if (/\b(kill all|close all|stop all|chiudi tutto|ferma tutto)\b/i.test(lower)) {
    const count = await closeTerminalWindows();
    return count ? `Closed ${count} terminal${count === 1 ? "" : "s"}` : "No terminals to close";
  }

  const target = findTargetTerminal(t);
  if (target) {
    const { id: termId, runtime } = target;

    // Always try to visually select the targeted terminal on canvas
    selectTerminalNode(termId);

    // Direct management / focus commands
    if (/\b(focus|select|switch to|go to|bring up)\b/i.test(lower)) {
      return `Focused ${runtime.title || runtime.kind} terminal`;
    }
    if (/\b(kill|close|stop|exit)\b/i.test(lower)) {
      sidecar.killTerminal(termId);
      // re-tile the remaining ones if auto is on
      retileTerminalsIfAuto();
      return `Closed ${runtime.title || runtime.kind} terminal`;
    }
    if (/\b(restart|relaunch|reset)\b/i.test(lower)) {
      sidecar.stopTerminal(termId);
      setTimeout(() => {
        sidecar.startTerminal({
          kind: runtime.kind,
          cwd: runtime.cwd,
          title: runtime.title,
          terminalId: termId,
        });
      }, 200);
      return `Restarted ${runtime.title || runtime.kind}`;
    }

    // Send the rest as prompt / command to the target terminal
    // Strip the target phrase for cleaner input
    let prompt = t.replace(
      /(?:in|to|tell|send to|prompt|write in|run in)\s+(pi|claude|codex|cursor|shell|the\s+)?(?:terminal|agent)?\s*[:\-]?\s*/i,
      "",
    ).trim();
    if (!prompt) prompt = t; // fallback

    // If it looks like a question about the terminal, route to conductor instead of raw input
    const isQuestion = /\b(what|come|status|sta|doing|output|log|risultato|cosa)\b/i.test(prompt);
    if (isQuestion) {
      sidecar.conductorInput(`Regarding the ${runtime.title || runtime.kind} terminal: ${prompt}`);
      return `Asked about ${runtime.title || runtime.kind}`;
    }

    sidecar.writeTerminal(termId, `${prompt}\r`);
    useCanvasStore.getState().pushCanvasActivity(`Sent to ${runtime.title || runtime.kind}: ${prompt.slice(0, 80)}`);
    return `Sent to ${runtime.title || runtime.kind}: ${prompt}`;
  }

  // Unhandled → let the conductor (LLM) decide. Good for complex / multi-step agent tasks.
  return null;
}

function normalizeBrowserUrl(input: string) {
  if (/^https?:\/\//i.test(input)) return input;
  return `http://${input}`;
}

export default function CommandBar() {
  const [value, setValue] = useState("");
  const [flash, setFlash] = useState<string | null>(null);
  const [hintIndex, setHintIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const latestVoiceTextRef = useRef("");
  const lastDispatchedVoiceRef = useRef("");
  const awaitingVoiceFinalRef = useRef(false);

  const listening = useCanvasStore((s: any) => s.voiceListening);
  const rawPartial = useCanvasStore((s: any) => s.voicePartial);
  const voiceStatus = useCanvasStore((s: any) => s.voiceStatus) as string | undefined;
  const voiceMessage = useCanvasStore((s: any) => s.voiceMessage) as string | undefined;

  // Throttle the live caption using requestAnimationFrame for smoother, lower-overhead updates.
  // Batches DOM updates better than setTimeout for 60fps feel, improves perf during long voice sessions.
  const [throttledPartial, setThrottledPartial] = useState("");
  const rafRef = useRef<number | null>(null);
  const lastFrameTimeRef = useRef(0);
  // Keep the newest partial in a ref so the RAF loop reads it without the effect
  // re-subscribing (and recreating the loop) on every transcript update.
  const rawPartialRef = useRef(rawPartial);
  rawPartialRef.current = rawPartial;
  useEffect(() => {
    if (!listening) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      setThrottledPartial("");
      return;
    }
    const update = () => {
      const now = performance.now();
      if (now - lastFrameTimeRef.current > 80) { // ~12fps throttle for caption smoothness vs perf
        lastFrameTimeRef.current = now;
        setThrottledPartial(normalizeVoiceCaption(rawPartialRef.current));
      }
      rafRef.current = requestAnimationFrame(update);
    };
    rafRef.current = requestAnimationFrame(update);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [listening]);

  // Surface STT failures clearly instead of failing silently. `denied` opens the
  // macOS Microphone privacy pane automatically (handled in the bridge); here we
  // also tell the user what to do.
  useEffect(() => {
    const m = voiceMessage ?? "";
    if (voiceStatus === "denied") {
      awaitingVoiceFinalRef.current = false;
      setFlash(m || "Microphone blocked — grant access in the Microphone pane that just opened, then try again.");
    } else if (voiceStatus === "error") {
      awaitingVoiceFinalRef.current = false;
      setFlash(m || "Voice input error. Check microphone permission and installed Whisper model.");
    } else if (voiceStatus === "downloading" || voiceStatus === "transcribing") {
      setFlash(m || voiceStatus);
    } else if (voiceStatus === "empty") {
      awaitingVoiceFinalRef.current = false;
      setFlash(m || "No speech detected.");
    }
  }, [voiceStatus, voiceMessage]);

  useEffect(() => {
    const timer = window.setInterval(() => setHintIndex((i) => (i + 1) % HINTS.length), 3500);
    return () => window.clearInterval(timer);
  }, []);

  // Surface conductor (SmolLM2 router) errors as a flash — today these are
  // otherwise invisible (the router has no visible terminal of its own).
  useEffect(() => {
    return sidecar.onAgentError((agentId, message) => {
      if (agentId !== CONDUCTOR_ID) return;
      showFlash(`Conductor: ${message}`);
    });
  }, []);

  const showFlash = (msg: string) => {
    setFlash(msg);
    setTimeout(() => setFlash(null), 2200);
  };

  // Global hotkeys: app-level Command shortcuts plus "/" focus.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = document.activeElement?.tagName;
      if (e.key === "/" && tag !== "INPUT" && tag !== "TEXTAREA") {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }

      if (!e.metaKey) return;
      const key = e.key.toLowerCase();

      if (key === "k" && !e.shiftKey) {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
        showFlash("Assistant focused");
        return;
      }

      if (!e.shiftKey) return;

      if (key === "t") {
        e.preventDefault();
        tileTerminals();
        showFlash("Arranged windows");
        return;
      }

      if (key === "b") {
        e.preventDefault();
        spawnBrowserNode();
        showFlash("Opened browser preview");
        return;
      }

      if (key === "w") {
        e.preventDefault();
        void closeTerminalWindows().then((count) => {
          showFlash(count ? `Closed ${count} terminal${count === 1 ? "" : "s"}` : "No terminals to close");
        });
        return;
      }

      if (key === "n") {
        e.preventDefault();
        spawnNoteNode();
        showFlash("Added note");
        return;
      }

    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Post-process transcribed text to improve comprehension of voice commands.
  // Handles common misrecognitions (especially Italian + tech terms), normalizes,
  // and boosts accuracy without slowing things down.
  function normalizeVoiceCaption(raw: string): string {
    let t = raw.trim();
    if (!t) return t;

    // Common Italian/English mishears and synonyms for better command matching
    const replacements: Array<[RegExp, string]> = [
      // Italian synonyms / misrecognitions
      [/\bterminale\b/g, "terminal"],
      [/\bterminali\b/g, "terminals"],
      [/\btutti\b/g, "all"],
      [/\btutte\b/g, "all"],
      [/\bagenti\b/g, "agents"],
      [/\banteprima\b/g, "preview"],
      [/\banteprime\b/g, "previews"],
      [/\bapri\b/g, "open"],
      [/\bchiudi\b/g, "close"],
      [/\bchiudere\b/g, "close"],
      [/\bferma\b/g, "stop"],
      [/\btermina\b/g, "stop"],
      [/\buccidi\b/g, "kill"],
      [/\briavvia\b/g, "restart"],
      [/\bseleziona\b/g, "focus"],
      [/\binvia\b/g, "send"],
      [/\bscrivi\b/g, "write"],
      [/\besegui\b/g, "run"],
      [/\borganizza\b/g, "tile"],
      // Tech names that get mangled
      [/\bpai\b/g, "pi"],
      [/\bclaud\b/g, "claude"],
      [/\bcodex\b/g, "codex"],
      [/\bcursore\b/g, "cursor"],
      // Common phrases
      [/\bin the\b/g, "in the"],
      [/\bthe terminal\b/g, "the terminal"],
      [/\bterminal number\b/g, "terminal"],
    ];

    for (const [re, rep] of replacements) {
      t = t.replace(re, rep);
    }

    // Light cleanup for captions
    t = t.replace(/\s+/g, " ").trim();

    return t;
  }

  const dispatchVoiceCommand = (text: string) => {
    const normalized = normalizeVoiceCaption(text);
    const t = normalized.trim();
    if (!t || t === lastDispatchedVoiceRef.current) return;
    lastDispatchedVoiceRef.current = t;
    void dispatch(t);
  };

  // Finalized transcripts from the cross-platform Whisper STT plugin.
  // Pure manual press-to-talk: user clicks mic to start, speaks, clicks again to stop + send.
  useEffect(() => {
    return onVoiceFinal((text) => {
      awaitingVoiceFinalRef.current = false;
      const normalized = normalizeVoiceCaption(text);
      const t = normalized.trim();
      if (!t) return;
      latestVoiceTextRef.current = t;
      setValue("");
      dispatchVoiceCommand(t);
    });
  }, []);

  // Central dispatch: normalize the voice/text for better comprehension, then run local parser
  // or fall back to conductor. This centralizes caption processing.
  const dispatch = async (rawText: string) => {
    const cleaned = normalizeVoiceCaption(rawText);
    const t = cleaned.trim();
    if (!t) return;

    const result = await run(t);
    if (result) {
      showFlash(result);
      return;
    }

    // Hand off to the SmolLM2 conductor. The actual outcome (canvas actions
    // applied, or an error) arrives asynchronously and is surfaced via the
    // conductor-error listener registered once on mount.
    sidecar.conductorInput(t);
    showFlash("Assistant is thinking…");
  };

  const submit = () => {
    if (listening) {
      toggleMic();
      return;
    }
    const text = value.trim();
    if (!text) return;
    void dispatch(text);
    setValue("");
    latestVoiceTextRef.current = "";
  };

  const toggleMic = () => {
    if (listening) {
      awaitingVoiceFinalRef.current = true;
      useCanvasStore.getState().setVoicePartial("");
      void stopVoice();
      window.setTimeout(() => {
        if (!awaitingVoiceFinalRef.current) return;
        awaitingVoiceFinalRef.current = false;
        latestVoiceTextRef.current = "";
        showFlash("No speech detected.");
      }, 15000);
    } else {
      if (!voiceSupported()) {
        showFlash("Voice needs the Tauri desktop app, not the web preview.");
        return;
      }
      lastDispatchedVoiceRef.current = "";
      latestVoiceTextRef.current = "";
      awaitingVoiceFinalRef.current = false;
      void startVoice();
    }
  };

  const displayValue = listening ? throttledPartial : value;
  const hint =
    voiceStatus === "downloading" ? (voiceMessage || "Downloading speech model…") :
    voiceStatus === "transcribing" ? "Transcribing…" :
    listening ? "Parla… premi di nuovo il microfono per inviare" :
    HINTS[hintIndex];
  const canSubmit = listening || Boolean(value.trim());

  return (
    <div
      className={`cmdbar ${listening ? 'is-listening' : ''}`}
      role="search"
    >
      {flash && <div className="cmdbar__flash" role="status">{flash}</div>}

      <button
        className={`cmdbar__mic ${listening ? "is-live" : ""}`}
        data-tauri-drag-region="false"
        onClick={toggleMic}
        title={listening ? "Stop listening" : "Start assistant voice command"}
        aria-label="Toggle voice input"
      >
        {listening ? "■" : "🎙"}
      </button>

      <input
        ref={inputRef}
        value={displayValue}
        placeholder={hint}
        aria-label="Canvas assistant"
        readOnly={listening}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            submit();
          }
          if (e.key === "Escape") {
            setValue("");
            setFlash(null);
            (e.target as HTMLInputElement).blur();
          }
        }}
      />
      <button data-tauri-drag-region="false" onClick={submit} disabled={!canSubmit} title="Ask assistant" aria-label="Ask assistant">↵</button>
    </div>
  );
}
