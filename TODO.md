# TODO

## Verify v1 (implemented, not yet tested end to end)

- [ ] `lib/llama.js` against the running server: `health`, `props`, `tokenize`, streaming chat
- [ ] Confirm no `<think>` output appears with `enable_thinking: false`
- [ ] Paste → stream → Copy / Cancel
- [ ] Context check and the "too long" / "Summarize first part" path
- [ ] Right-click *Summarize selection* and *Summarize page*, including when the panel is already open
- [ ] Clear button resets input, summary and notes
- [ ] Images: paste a screenshot, drop a file, Add image…, remove a thumbnail, 5th image rejected
- [ ] Images: image alone, image + text, server without `--mmproj` shows the vision error
- [ ] Images: confirm the token estimate against the server's real `prompt_tokens`
- [ ] Length dropdown persists across browser restarts
- [ ] "Clear text and images when summarizing": clears once the request is sent; restores input on error or Cancel with no output
- [ ] Shortcuts: `Alt+Shift+S` with a selection, with no selection (error note), with the panel already open; `Alt+Shift+P`; `Alt+Shift+Q`
- [ ] Settings save (base URL, model, API key, length, temperature, clear-on-summarize)
- [ ] Server off, server loading (503 auto-retry), a huge page, Cancel mid-stream
- [ ] Panel closed mid-stream

## Docs

- [x] README: images, keyboard shortcuts, settings behaviour
- [x] README: prerequisites, packages, `.env` variables, Mermaid diagrams
- [ ] Add a Troubleshooting section (server offline, CORS/`--api-key`, context too small)
- [ ] Document Windows setup (the start script is Bash only; a PowerShell equivalent?)
- [x] Refresh `docs/screenshot.png` to show a finished summary

## Later (v2)

- [ ] Map-reduce summaries for text over the context budget (summarize chunks, then summarize the summaries)
- [ ] Readability-style article extraction for *Summarize page*
- [ ] Optional Markdown rendering through a sanitizer
- [x] Paste / drop / pick images in the panel (implemented, untested; see the verify list)
- [ ] Right-click an image → *Summarize image* (needs fetching `info.srcUrl` from the service worker)
- [ ] Capture the visible tab as a screenshot
