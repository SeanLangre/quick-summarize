# Quick Summarize

A Chrome (Manifest V3) extension that summarizes text with a local Qwen model served by `llama-server`.
It summarizes pasted text, a selection, or the current page, and nothing leaves the machine.
There is no MCP server or client; the extension talks to `llama-server` over plain HTTP.

![Quick Summarize side panel](docs/screenshot.png)

## Setup

1. `cp .env.example .env` and fill in your paths (`.env` is gitignored).
2. Start the server: `./scripts/start-server.sh`
3. In `chrome://extensions`, enable Developer mode → **Load unpacked** → select this folder.
4. Click the toolbar icon to open the side panel, or right-click a page or selection →
   *Summarize page* / *Summarize selection*.

## The model server

The extension reuses the `llama-server` instance that `qwen-jev-controller` uses (default
`http://127.0.0.1:8080/v1`, same as `QWEN_BASE_URL`).

| Fact | Consequence for the extension |
| --- | --- |
| One model loaded; `model` is ignored | `model` is an optional setting, sent only if set |
| Qwen3.5 thinks by default | Sends `chat_template_kwargs: {enable_thinking: false}`; also strips any `<think>…</think>` |
| Context size depends on how the server was launched | Reads `n_ctx` from `GET /props` at runtime; never hardcoded |
| Optional `--api-key` | Optional API key setting, sent as `Authorization: Bearer …` |
| Shared with the Balatro bot | A summary may queue behind bot requests; the panel shows a waiting state and allows Cancel |

## Architecture

```
┌──────────── Chrome ────────────────────────────────┐
│ background.js (service worker)                     │
│   • context menu: "Summarize selection" / "page"   │
│   • grabs text via chrome.scripting                │
│   • stashes it in chrome.storage.session           │
│   • opens the side panel                           │
│                                                    │
│ sidepanel.html/js  ── fetch (streaming) ───────────┼──► llama-server 127.0.0.1:8080
│   • text box, length, Summarize / Cancel / Copy    │      GET  /health
│   • health + context checks, settings              │      GET  /props
└────────────────────────────────────────────────────┘      POST /tokenize
                                                            POST /v1/chat/completions
```

- **Side panel, not popup:** a popup closes (killing its request) when it loses focus, and local inference takes 10–60 s.
- **Request runs in the panel, not the service worker:** the panel stays alive for the whole request and renders the stream
  directly. Closing the panel cancels the request.
- **CORS:** extension pages with `host_permissions` for `http://127.0.0.1/*` are not subject to CORS, so no proxy is needed.

```
quick-summarize/
├── manifest.json
├── background.js        # service worker: context menus, text capture, open panel
├── sidepanel.html/css/js  # UI state, settings, Copy/Cancel
├── lib/llama.js         # health(), nCtx(), tokenize(), streamChat() — the only code that talks to the server
├── lib/prompt.js        # buildMessages(), LENGTHS table
├── scripts/start-server.sh
└── icons/
```

## Request flow

1. **Input.** Pasted text, or the right-click menu. *Selection* uses `window.getSelection().toString()` (keeps line
   breaks); *page* uses `document.body.innerText`. The service worker writes `{text, source, title, url}` to
   `chrome.storage.session` and opens the panel inside the menu-click handler (it needs a user gesture). The panel picks
   it up on load and on `storage.onChanged`.
2. **Server check** before each request: `GET /health` — `200` ready, `503` model loading, network error = not running.
3. **Context check.** `n_ctx` from `/props`, input size from `/tokenize`. Budget = `n_ctx − max_tokens − ~300`. Over
   budget shows "Text is ~N tokens; the server fits ~M" and offers **Summarize first part**.
4. **Request.** `POST /v1/chat/completions` with `stream: true` and an `AbortController` wired to Cancel.
5. **Stream.** Parse SSE `data:` lines, append deltas with `textContent`, stop at `[DONE]`. `finish_reason: length`
   shows a "cut off" note.
6. **Done.** Copy enabled; last input and summary kept in `chrome.storage.session`.

## Prompt

Instructions go in the system message; the text goes in the user message inside `<text>` delimiters so the model treats
it as data (see `lib/prompt.js`).

| Length | Instruction | `max_tokens` |
| --- | --- | --- |
| Short | 1–2 sentences | 150 |
| Medium (default) | 3–5 bullet points | 400 |
| Long | One-sentence overview, then up to 10 bullets | 900 |

Temperature 0.3, `enable_thinking: false`. `model` is added only if set in settings.

## Settings

Stored in `chrome.storage.local`, in the collapsible section of the panel: base URL, model (optional), API key
(optional), default length, temperature.

## UI states

| State | What the panel shows |
| --- | --- |
| Server offline | Red dot, "llama-server not reachable at …", start command, Retry |
| Model loading (`503`) | Amber dot, "Model loading…", auto-retry every 2 s |
| Ready | Green dot; Summarize enabled when the text is non-empty |
| Too long | Token count vs budget, "Summarize first part" |
| Waiting / streaming | Spinner until the first token, then live text; Cancel enabled |
| Error | The server's error message (first 300 chars), Retry |
| Done | Summary, Copy, "cut off" note if `finish_reason: length` |

## Security notes

- Model output is rendered with `textContent` only, never `innerHTML`.
- Keep `llama-server` bound to `127.0.0.1`. It allows cross-origin requests by default, so any website you visit can
  call it from your browser. If that matters, start it with `--api-key` and put the key in the extension settings.
- Page text is read only on an explicit user action (menu click). No content script runs on every page.
