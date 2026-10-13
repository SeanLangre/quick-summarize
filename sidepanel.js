import { DEFAULT_BASE_URL, health, serverProps, tokenize, streamChat, clearPropsCache } from "./lib/llama.js";
import { LENGTHS, PROMPT_OVERHEAD_TOKENS, MAX_IMAGES, MAX_IMAGE_EDGE, imageTokens, buildMessages } from "./lib/prompt.js";

const $ = (id) => document.getElementById(id);
const el = {
  dot: $("dot"), status: $("status"), retry: $("retry"),
  offlineHelp: $("offline-help"),
  source: $("source"), input: $("input"), length: $("length"),
  summarize: $("summarize"), cancel: $("cancel"),
  toolong: $("toolong"), toolongText: $("toolong-text"), firstPart: $("first-part"),
  error: $("error"), result: $("result"), spinner: $("spinner"),
  copy: $("copy"), clear: $("clear"), output: $("output"), cutoff: $("cutoff"),
  images: $("images"), addImage: $("add-image"), file: $("file"), main: document.querySelector("main"),
  sBaseUrl: $("s-baseUrl"), sModel: $("s-model"), sApiKey: $("s-apiKey"),
  sLength: $("s-length"), sClear: $("s-clearOnSummarize"), sTemp: $("s-temperature"), sSave: $("s-save"), sSaved: $("s-saved"),
};

const DEFAULTS = { baseUrl: DEFAULT_BASE_URL, model: "", apiKey: "", length: "medium", temperature: 0.3, clearOnSummarize: false };
let settings = { ...DEFAULTS };
let serverState = "unknown";
let meta = { source: "pasted", title: "", url: "" };
let controller = null;
let healthTimer = null;
let overBudget = null; // { budget } when the current input is too long
let images = []; // [{ dataUrl, w, h, tokens }]

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
  el.sClear.checked = settings.clearOnSummarize;
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
    clearOnSummarize: el.sClear.checked,
  };
  await chrome.storage.local.set({ settings });
  clearPropsCache();
  el.length.value = settings.length;
  el.sSaved.textContent = "Saved";
  setTimeout(() => (el.sSaved.textContent = ""), 1500);
  checkServer();
});

// The main Length dropdown is the default length: remember it across sessions.
el.length.addEventListener("change", () => {
  settings.length = el.length.value;
  el.sLength.value = settings.length;
  chrome.storage.local.set({ settings }).catch(() => {});
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
  el.summarize.disabled = busy() || serverState !== "ready" || !(el.input.value.trim() || images.length);
  el.addImage.disabled = busy() || images.length >= MAX_IMAGES;
  el.cancel.disabled = !busy();
  el.clear.disabled = busy() || !el.output.textContent;
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

// ---------- images ----------

function readImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      // Downscale to bound the token cost; re-encode as JPEG on a white background.
      const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.max(1, Math.round(img.naturalWidth * scale));
      const h = Math.max(1, Math.round(img.naturalHeight * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      resolve({ dataUrl: canvas.toDataURL("image/jpeg", 0.9), w, h, tokens: imageTokens(w, h) });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`Could not read image "${file.name || "pasted image"}".`));
    };
    img.src = url;
  });
}

function renderImages() {
  el.images.textContent = "";
  el.images.hidden = images.length === 0;
  images.forEach((im, i) => {
    const wrap = document.createElement("div");
    wrap.className = "thumb";
    const t = document.createElement("img");
    t.src = im.dataUrl;
    t.alt = `Image ${i + 1}`;
    const rm = document.createElement("button");
    rm.type = "button";
    rm.textContent = "×";
    rm.title = "Remove image";
    rm.addEventListener("click", () => {
      if (busy()) return;
      images.splice(i, 1);
      imagesChanged();
    });
    wrap.append(t, rm);
    el.images.append(wrap);
  });
}

function imagesChanged() {
  el.toolong.hidden = true;
  overBudget = null;
  renderImages();
  updateButtons();
  saveState();
}

async function addFiles(files) {
  const picked = [...files].filter((f) => f.type.startsWith("image/"));
  if (!picked.length) return;
  showError("");
  for (const f of picked) {
    if (images.length >= MAX_IMAGES) {
      showError(`At most ${MAX_IMAGES} images.`);
      break;
    }
    try {
      images.push(await readImage(f));
    } catch (e) {
      showError(e.message);
    }
  }
  imagesChanged();
}

el.addImage.addEventListener("click", () => el.file.click());
el.file.addEventListener("change", () => {
  addFiles(el.file.files);
  el.file.value = "";
});

document.addEventListener("paste", (e) => {
  const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith("image/"));
  if (!files.length) return; // plain text: let the textarea handle it
  e.preventDefault();
  addFiles(files);
});

for (const type of ["dragenter", "dragover"]) {
  document.addEventListener(type, (e) => {
    if (![...(e.dataTransfer?.types || [])].includes("Files")) return;
    e.preventDefault();
    el.main.classList.add("drag");
  });
}
for (const type of ["dragleave", "drop"]) {
  document.addEventListener(type, (e) => {
    if (type === "drop") {
      e.preventDefault();
      addFiles(e.dataTransfer?.files || []);
    }
    el.main.classList.remove("drag");
  });
}

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
  const sendImages = images;
  let cleared = null; // { input, images, meta } when the fields were cleared for this request

  controller = new AbortController();
  const { signal } = controller;
  el.result.hidden = false;
  el.spinner.hidden = false;
  updateButtons();

  try {
    const [props, textTokens] = await Promise.all([
      serverProps(conn()),
      text ? tokenize(text, conn()) : 0,
    ]);
    if (sendImages.length && props.vision === false) {
      throw new Error("This server has no vision model loaded (start it with --mmproj).");
    }
    const imageCost = sendImages.reduce((n, im) => n + im.tokens, 0);
    const budget = props.nCtx - maxTokens - PROMPT_OVERHEAD_TOKENS - imageCost;
    const tokens = textTokens;
    if (budget <= 0) {
      throw new Error(
        `The images need ~${imageCost} tokens but the server context is ${props.nCtx}. Remove an image or raise CTX_SIZE.`,
      );
    }
    if (tokens > budget) {
      overBudget = { budget, tokens };
      el.toolongText.textContent = `Text is ~${tokens} tokens; the server fits ~${budget}${imageCost ? " alongside the images" : ""}.`;
      el.toolong.hidden = false;
      el.result.hidden = true;
      return;
    }

    if (settings.clearOnSummarize) {
      cleared = { input: el.input.value, images, meta };
      el.input.value = "";
      images = [];
      meta = { source: "pasted", title: "", url: "" };
      setSource();
      renderImages();
      updateButtons();
    }

    let first = true;
    const { finishReason } = await streamChat(
      { messages: buildMessages(text, length, cleared?.meta ?? meta, sendImages), maxTokens, temperature: settings.temperature },
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
    // Nothing came back: give the input back so it isn't lost on error or Cancel.
    if (cleared && !el.output.textContent && !el.input.value && !images.length) {
      el.input.value = cleared.input;
      images = cleared.images;
      meta = cleared.meta;
      setSource();
      renderImages();
    }
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

el.clear.addEventListener("click", () => {
  resetResult();
  showError("");
  el.result.hidden = true;
  updateButtons();
  saveState();
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
  // Images go under their own key so a quota error cannot lose the text state.
  chrome.storage.session.set({ lastImages: images }).catch(() => {});
  chrome.storage.session.set({
    last: { input: el.input.value, output: el.output.textContent, meta, cut: !el.cutoff.hidden },
  }).catch(() => {});
}

async function restoreState() {
  const { last, lastImages } = await chrome.storage.session.get(["last", "lastImages"]);
  images = Array.isArray(lastImages) ? lastImages : [];
  renderImages();
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
