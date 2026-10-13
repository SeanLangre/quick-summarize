import { DEFAULT_BASE_URL, health, nCtx, tokenize, streamChat, clearPropsCache } from "./lib/llama.js";
import { LENGTHS, PROMPT_OVERHEAD_TOKENS, buildMessages } from "./lib/prompt.js";

const $ = (id) => document.getElementById(id);
const el = {
  dot: $("dot"), status: $("status"), retry: $("retry"),
  offlineHelp: $("offline-help"),
  source: $("source"), input: $("input"), length: $("length"),
  summarize: $("summarize"), cancel: $("cancel"),
  toolong: $("toolong"), toolongText: $("toolong-text"), firstPart: $("first-part"),
  error: $("error"), result: $("result"), spinner: $("spinner"),
  copy: $("copy"), output: $("output"), cutoff: $("cutoff"),
  sBaseUrl: $("s-baseUrl"), sModel: $("s-model"), sApiKey: $("s-apiKey"),
  sLength: $("s-length"), sTemp: $("s-temperature"), sSave: $("s-save"), sSaved: $("s-saved"),
};

const DEFAULTS = { baseUrl: DEFAULT_BASE_URL, model: "", apiKey: "", length: "medium", temperature: 0.3 };
let settings = { ...DEFAULTS };
let serverState = "unknown";
let meta = { source: "pasted", title: "", url: "" };
let controller = null;
let healthTimer = null;
let overBudget = null; // { budget } when the current input is too long

const conn = () => ({ baseUrl: settings.baseUrl, apiKey: settings.apiKey, model: settings.model });

// ---------- settings ----------

async function loadSettings() {
  const { settings: saved } = await chrome.storage.local.get("settings");
  settings = { ...DEFAULTS, ...saved };
  el.sBaseUrl.value = settings.baseUrl;
  el.sModel.value = settings.model;
  el.sApiKey.value = settings.apiKey;
  el.sLength.value = settings.length;
  el.sTemp.value = settings.temperature;
  el.length.value = settings.length;
}

el.sSave.addEventListener("click", async () => {
  const temp = parseFloat(el.sTemp.value);
  settings = {
    baseUrl: el.sBaseUrl.value.trim() || DEFAULTS.baseUrl,
    model: el.sModel.value.trim(),
    apiKey: el.sApiKey.value.trim(),
    length: el.sLength.value,
    temperature: Number.isFinite(temp) ? temp : DEFAULTS.temperature,
  };
  await chrome.storage.local.set({ settings });
  clearPropsCache();
  el.length.value = settings.length;
  el.sSaved.textContent = "Saved";
  setTimeout(() => (el.sSaved.textContent = ""), 1500);
  checkServer();
});

// ---------- server status ----------

async function checkServer() {
  clearTimeout(healthTimer);
  const h = await health(conn());
  serverState = h.state;
  el.dot.className = `dot ${h.state}`;
  el.offlineHelp.hidden = h.state !== "offline";
  el.retry.hidden = h.state === "ready" || h.state === "loading";
  el.status.textContent = {
    ready: "Server ready",
    loading: "Model loading…",
    offline: `llama-server not reachable at ${settings.baseUrl}`,
    error: h.message || "Server error",
  }[h.state];
  if (h.state === "loading") healthTimer = setTimeout(checkServer, 2000);
  updateButtons();
  return h.state;
}
el.retry.addEventListener("click", checkServer);

// ---------- UI helpers ----------

function busy() { return controller !== null; }

function updateButtons() {
  el.summarize.disabled = busy() || serverState !== "ready" || !el.input.value.trim();
  el.cancel.disabled = !busy();
}

function showError(msg) {
  el.error.textContent = msg;
  el.error.hidden = !msg;
}

function resetResult() {
  el.output.textContent = "";
  el.cutoff.hidden = true;
  el.copy.disabled = true;
}

function setSource() {
  if (meta.source === "pasted") { el.source.hidden = true; return; }
  el.source.hidden = false;
  el.source.textContent = `${meta.source}: ${meta.title || meta.url}`;
}

el.input.addEventListener("input", () => {
  meta = { source: "pasted", title: "", url: "" };
  setSource();
  el.toolong.hidden = true;
  overBudget = null;
  updateButtons();
  saveState();
});

// ---------- summarize ----------

async function summarize(text) {
  showError("");
  el.toolong.hidden = true;
  overBudget = null;
  resetResult();

  const state = await checkServer();
  if (state !== "ready") return;

  const length = el.length.value;
  const { maxTokens } = LENGTHS[length];

  controller = new AbortController();
  const { signal } = controller;
  el.result.hidden = false;
  el.spinner.hidden = false;
  updateButtons();

  try {
    const [ctx, tokens] = await Promise.all([nCtx(conn()), tokenize(text, conn())]);
    const budget = ctx - maxTokens - PROMPT_OVERHEAD_TOKENS;
    if (tokens > budget) {
      overBudget = { budget, tokens };
      el.toolongText.textContent = `Text is ~${tokens} tokens; the server fits ~${budget}.`;
      el.toolong.hidden = false;
      el.result.hidden = true;
      return;
    }

    let first = true;
    const { finishReason } = await streamChat(
      { messages: buildMessages(text, length, meta), maxTokens, temperature: settings.temperature },
      conn(),
      {
        signal,
        onFirstByte: () => {},
        onToken: (t) => {
          if (first) { el.spinner.hidden = true; first = false; }
          el.output.textContent += t;
        },
      },
    );
    el.cutoff.hidden = finishReason !== "length";
    el.copy.disabled = !el.output.textContent;
  } catch (e) {
    if (e.name !== "AbortError") showError(String(e.message || e).slice(0, 300));
    else if (!el.output.textContent) el.result.hidden = true;
  } finally {
    controller = null;
    el.spinner.hidden = true;
    el.copy.disabled = !el.output.textContent;
    updateButtons();
    saveState();
  }
}

el.summarize.addEventListener("click", () => summarize(el.input.value.trim()));
el.cancel.addEventListener("click", () => controller?.abort());

el.firstPart.addEventListener("click", async () => {
  if (!overBudget) return;
  const full = el.input.value.trim();
  const { budget, tokens } = overBudget;
  // Truncate by character ratio, then shrink until it fits (tokenize is cheap).
  let cut = Math.floor(full.length * (budget / tokens) * 0.95);
  let part = full.slice(0, cut);
  try {
    for (let i = 0; i < 5; i++) {
      const n = await tokenize(part, conn());
      if (n <= budget) break;
      cut = Math.floor(cut * (budget / n) * 0.95);
      part = full.slice(0, cut);
    }
  } catch (e) {
    showError(String(e.message || e).slice(0, 300));
    return;
  }
  summarize(part);
});

el.copy.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(el.output.textContent);
    el.copy.textContent = "Copied";
  } catch {
    el.copy.textContent = "Copy failed";
  }
  setTimeout(() => (el.copy.textContent = "Copy"), 1200);
});

// ---------- persistence of last input/summary ----------

function saveState() {
  chrome.storage.session.set({
    last: { input: el.input.value, output: el.output.textContent, meta, cut: !el.cutoff.hidden },
  }).catch(() => {});
}

async function restoreState() {
  const { last } = await chrome.storage.session.get("last");
  if (!last) return;
  el.input.value = last.input || "";
  meta = last.meta || meta;
  setSource();
  if (last.output) {
    el.output.textContent = last.output;
    el.result.hidden = false;
    el.cutoff.hidden = !last.cut;
    el.copy.disabled = false;
  }
}

// ---------- hand-off from the service worker ----------

let handledId = null;

async function takePending(p) {
  if (!p || p.id === handledId) return;
  handledId = p.id;
  if (busy()) controller.abort();
  await chrome.storage.session.set({ handledId: p.id });
  if (p.error) {
    showError(p.error);
    return;
  }
  el.input.value = p.text;
  meta = { source: p.source, title: p.title, url: p.url };
  setSource();
  updateButtons();
  // Wait out an in-flight abort, then summarize.
  await new Promise((r) => setTimeout(r, 0));
  summarize(p.text);
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "session" && changes.pending?.newValue) takePending(changes.pending.newValue);
});

// ---------- init ----------

(async function init() {
  await loadSettings();
  await restoreState();
  updateButtons();
  await checkServer();
  const { pending, handledId: done } = await chrome.storage.session.get(["pending", "handledId"]);
  if (pending && pending.id !== done) takePending(pending);
  else if (pending) handledId = pending.id;
})();
