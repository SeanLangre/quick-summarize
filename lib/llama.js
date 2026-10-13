// The only code that talks to llama-server.

export const DEFAULT_BASE_URL = "http://127.0.0.1:8080/v1";

const root = (baseUrl) => baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "");
const headers = (apiKey, json = false) => {
  const h = {};
  if (json) h["Content-Type"] = "application/json";
  if (apiKey) h.Authorization = `Bearer ${apiKey}`;
  return h;
};

async function errorText(res) {
  const t = await res.text().catch(() => "");
  try {
    const j = JSON.parse(t);
    return (j.error?.message || j.error || t).toString().slice(0, 300);
  } catch {
    return t.slice(0, 300) || `HTTP ${res.status}`;
  }
}

/** Returns "ready" | "loading" | "offline" | "error". */
export async function health({ baseUrl, apiKey }) {
  try {
    const res = await fetch(`${root(baseUrl)}/health`, { headers: headers(apiKey) });
    if (res.ok) return { state: "ready" };
    if (res.status === 503) return { state: "loading" };
    return { state: "error", message: await errorText(res) };
  } catch {
    return { state: "offline" };
  }
}

let propsCache = new Map();

export async function nCtx({ baseUrl, apiKey }) {
  const key = root(baseUrl);
  if (propsCache.has(key)) return propsCache.get(key);
  const res = await fetch(`${key}/props`, { headers: headers(apiKey) });
  if (!res.ok) throw new Error(await errorText(res));
  const j = await res.json();
  const n = j.default_generation_settings?.n_ctx ?? j.n_ctx;
  if (!n) throw new Error("Server did not report n_ctx");
  propsCache.set(key, n);
  return n;
}

export function clearPropsCache() {
  propsCache = new Map();
}

export async function tokenize(text, { baseUrl, apiKey }) {
  const res = await fetch(`${root(baseUrl)}/tokenize`, {
    method: "POST",
    headers: headers(apiKey, true),
    body: JSON.stringify({ content: text }),
  });
  if (!res.ok) throw new Error(await errorText(res));
  return (await res.json()).tokens.length;
}

/**
 * Streams a chat completion. Calls onToken(str) per delta.
 * Resolves to { finishReason }. Rejects with AbortError on cancel.
 */
export async function streamChat(
  { messages, maxTokens, temperature },
  { baseUrl, apiKey, model },
  { signal, onToken, onFirstByte },
) {
  const body = {
    messages,
    temperature,
    max_tokens: maxTokens,
    stream: true,
    chat_template_kwargs: { enable_thinking: false },
  };
  if (model) body.model = model;

  const res = await fetch(`${root(baseUrl)}/v1/chat/completions`, {
    method: "POST",
    headers: headers(apiKey, true),
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) throw new Error(await errorText(res));
  onFirstByte?.();

  // Strip <think>…</think> defensively, even across chunk boundaries.
  let inThink = false;
  let pending = "";
  const emit = (chunk) => {
    pending += chunk;
    for (;;) {
      if (inThink) {
        const end = pending.indexOf("</think>");
        if (end < 0) {
          pending = pending.slice(-8);
          return;
        }
        pending = pending.slice(end + 8).replace(/^\s+/, "");
        inThink = false;
      } else {
        const start = pending.indexOf("<think>");
        if (start >= 0) {
          if (start > 0) onToken(pending.slice(0, start));
          pending = pending.slice(start + 7);
          inThink = true;
          continue;
        }
        // Hold back a possible partial "<think>" tag at the end.
        let keep = 0;
        for (let i = Math.min(6, pending.length); i > 0; i--) {
          if ("<think>".startsWith(pending.slice(-i))) {
            keep = i;
            break;
          }
        }
        const out = pending.slice(0, pending.length - keep);
        pending = pending.slice(pending.length - keep);
        if (out) onToken(out);
        return;
      }
    }
  };

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let finishReason = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") {
        if (!inThink && pending) onToken(pending);
        return { finishReason };
      }
      let j;
      try {
        j = JSON.parse(data);
      } catch {
        continue;
      }
      if (j.error) throw new Error(String(j.error.message || j.error).slice(0, 300));
      const choice = j.choices?.[0];
      if (choice?.delta?.content) emit(choice.delta.content);
      if (choice?.finish_reason) finishReason = choice.finish_reason;
    }
  }
  if (!inThink && pending) onToken(pending);
  return { finishReason };
}
