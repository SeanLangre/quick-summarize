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

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab?.id) return;
  // sidePanel.open needs the user gesture, so call it synchronously first.
  const opened = chrome.sidePanel.open({ windowId: tab.windowId });
  const wantSelection = info.menuItemId === MENU_SELECTION;

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
    if (!text && wantSelection) text = (info.selectionText || "").trim();

    await chrome.storage.session.set({
      pending: {
        id: Date.now(),
        text,
        source: wantSelection ? "selection" : "page",
        title: tab.title || "",
        url: tab.url || "",
        error: text ? null : "Could not read text from this page.",
      },
    });
    await opened.catch(() => {});
  })();
});
