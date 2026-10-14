/**
 * Injected into the page with chrome.scripting.executeScript, so it must be
 * self-contained. Shows `text` in a centered reading card over the page;
 * clicking the backdrop or pressing Escape closes it.
 */
export function showReaderOverlay(text, title) {
  document.getElementById("quick-summarize-reader")?.remove();

  const host = document.createElement("div");
  host.id = "quick-summarize-reader";
  const root = host.attachShadow({ mode: "closed" });
  root.innerHTML = `
    <style>
      :host { all: initial; }
      .backdrop {
        --bg: #fbfaf7; --fg: #23211e; --muted: #77736c;
        position: fixed; inset: 0; z-index: 2147483647;
        display: flex; align-items: center; justify-content: center;
        padding: 24px; background: rgba(0, 0, 0, .55);
        animation: fade .15s ease-out;
      }
      @media (prefers-color-scheme: dark) {
        .backdrop { --bg: #1c1b19; --fg: #e6e2da; --muted: #9a958c; }
      }
      .card {
        box-sizing: border-box; width: min(960px, 100%); max-height: min(900px, 90vh);
        overflow-y: auto; overscroll-behavior: contain;
        padding: 48px 56px 56px; border-radius: 12px;
        background: var(--bg); color: var(--fg); box-shadow: 0 20px 60px rgba(0, 0, 0, .4);
        font: 22px/1.7 Charter, "Bitstream Charter", Georgia, "Iowan Old Style", serif;
        text-align: left; outline: none; user-select: none;
      }
      h1 { margin: 0 0 24px; font: 600 16px/1.4 system-ui, sans-serif; color: var(--muted); }
      p { margin: 0 0 1em; white-space: pre-wrap; word-break: break-word; hyphens: auto; }
      p.item { margin-bottom: 1.1em; padding-left: 1.2em; text-indent: -1.2em; }
      @keyframes fade { from { opacity: 0; } }
      @media (max-width: 600px) { .card { padding: 28px 24px 32px; } }
    </style>
    <div class="backdrop"><div class="card" tabindex="-1" role="dialog" aria-modal="true"></div></div>`;

  const backdrop = root.querySelector(".backdrop");
  const card = root.querySelector(".card");
  if (title) {
    const h = document.createElement("h1");
    h.textContent = title;
    card.append(h);
  }
  // One block per line so list items and paragraphs get space between them.
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const p = document.createElement("p");
    // Show "-" / "*" bullets as a dot.
    p.textContent = line.replace(/^(\s*)[-*](?=\s)/, "$1•");
    if (/^\s*([-*•]|\d+[.)])\s/.test(line)) p.className = "item";
    card.append(p);
  }

  const close = () => {
    host.remove();
    document.removeEventListener("keydown", onKey, true);
  };
  const onKey = (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      close();
    }
  };
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) close();
  });
  document.addEventListener("keydown", onKey, true);

  document.documentElement.append(host);
  card.focus({ preventScroll: true });
}
