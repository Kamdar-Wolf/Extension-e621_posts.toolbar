// background.js (MV3) — pouze servis pro stahování a otevírání do pozadí

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return;

  if (msg.type === "download") {
    const opts = { url: msg.url, saveAs: false, conflictAction: "uniquify" };
    if (msg.filename) opts.filename = msg.filename;
    chrome.downloads.download(opts, (id) => {
      const err = chrome.runtime.lastError;
      sendResponse(err ? { ok: false, error: err.message } : { ok: true, id });
    });
    return true;
  }

  if (msg.type === "openInBackground") {
    // k vytvoření záložky "tabs" permission nepotřebuješ
    chrome.tabs.create({ url: msg.url, active: false, openerTabId: sender?.tab?.id }, (tab) => {
      const err = chrome.runtime.lastError;
      sendResponse(err ? { ok: false, error: err.message } : { ok: true, tabId: tab?.id });
    });
    return true;
  }
});
