# TODO

## Verify v1 (implemented, not yet tested end to end)

- [ ] `lib/llama.js` against the running server: `health`, `props`, `tokenize`, streaming chat
- [ ] Confirm no `<think>` output appears with `enable_thinking: false`
- [ ] Paste → stream → Copy / Cancel
- [ ] Context check and the "too long" / "Summarize first part" path
- [ ] Right-click *Summarize selection* and *Summarize page*, including when the panel is already open
- [ ] Clear button resets input, summary and notes
- [ ] Settings save (base URL, model, API key, length, temperature)
- [ ] Server off, server loading (503 auto-retry), a huge page, Cancel mid-stream
- [ ] Panel closed mid-stream
- [ ] Running while the Balatro bot is using the server

## Docs

- [x] README: prerequisites, packages, `.env` variables, Mermaid diagrams
- [ ] Add a Troubleshooting section (server offline, CORS/`--api-key`, context too small)
- [ ] Document Windows setup (the start script is Bash only; a PowerShell equivalent?)
- [ ] Refresh `docs/screenshot.png` to show a finished summary

## Later (v2)

- [ ] Map-reduce summaries for text over the context budget (summarize chunks, then summarize the summaries)
- [ ] Readability-style article extraction for *Summarize page*
- [ ] Keyboard shortcut (`commands`) for "summarize selection"
- [ ] Optional Markdown rendering through a sanitizer
- [ ] Make `--mmproj` optional in `start-server.sh` until image summaries exist
- [ ] Summaries of images and screenshots (the server already has `--mmproj` loaded)
