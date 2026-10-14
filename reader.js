const { reader } = await chrome.storage.session.get("reader");
const title = document.getElementById("title");
const text = document.getElementById("text");
// One block per line so list items and paragraphs get space between them.
for (const line of (reader?.text || "").split("\n")) {
  if (!line.trim()) continue;
  const p = document.createElement("p");
  // Show "-" / "*" bullets as a dot.
  p.textContent = line.replace(/^(\s*)[-*](?=\s)/, "$1•");
  if (/^\s*([-*•]|\d+[.)])\s/.test(line)) p.className = "item";
  text.append(p);
}
if (reader?.title) {
  title.textContent = reader.title;
  title.hidden = false;
  document.title = reader.title;
}

// Clicking outside the window (it loses focus) or pressing Escape closes it.
window.addEventListener("blur", () => window.close());
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") window.close();
});
