const MENU_SELECTION = "qs-selection";
const MENU_PAGE = "qs-page";

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_SELECTION,
      title: "Summarize selection",
      contexts: ["selection"],
    });
    chrome.contextMenus.create({
      id: MENU_PAGE,
      title: "Summarize page",
      contexts: ["page", "selection"],
    });
  });
});

/**
 * Opens the panel and hands it the selection or page text of `tab`.
 * Must be called synchronously from a user gesture (menu click or command),
 * because sidePanel.open needs one.
 */
function summarizeTab(tab, wantSelection, fallbackSelection = "") {
  if (!tab?.id) return;
  const opened = chrome.sidePanel.open({ windowId: tab.windowId });

  (async () => {
    let text = "";
    try {
      const [result] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (selection) =>
          selection ? window.getSelection().toString() : document.body.innerText,
        args: [wantSelection],
      });
      text = (result?.result || "").trim();
    } catch (e) {
      // Restricted pages (chrome://, Web Store, PDF viewer, …)
      text = "";
    }
    if (!text && wantSelection) text = fallbackSelection.trim();

    await chrome.storage.session.set({
      pending: {
        id: Date.now(),
        text,
        source: wantSelection ? "selection" : "page",
        title: tab.title || "",
        url: tab.url || "",
        error: text
          ? null
          : wantSelection
            ? "No text selected. Select some text, then try again."
            : "Could not read text from this page.",
      },
    });
    await opened.catch(() => {});
  })();
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  summarizeTab(tab, info.menuItemId === MENU_SELECTION, info.selectionText || "");
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === "summarize-selection") summarizeTab(tab, true);
  else if (command === "summarize-page") summarizeTab(tab, false);
});
