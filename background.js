// background.js (MV3 service worker)

const PLACEHOLDER_URL = chrome.runtime.getURL("placeholder.html");

// openerTabId -> Set<pendingPlaceholderTabId>
const sessions = new Map();

// storage klíče
const MAP_KEY = 'kd_burst_map'; // { [tabId]: { url, alarmName, openerId? } }

// ---- helpers pro mapu v storage ----
async function getMap() {
  const o = await chrome.storage.local.get(MAP_KEY);
  return o[MAP_KEY] || {};
}
async function setMap(map) {
  await chrome.storage.local.set({ [MAP_KEY]: map });
}
async function addMapping(tabId, url, alarmName, openerId) {
  const map = await getMap();
  map[tabId] = { url, alarmName, openerId };
  await setMap(map);
}
async function removeMapping(tabId) {
  const map = await getMap();
  const entry = map[tabId];
  if (entry?.alarmName) chrome.alarms.clear(entry.alarmName);
  delete map[tabId];
  await setMap(map);
}
function openerForPlaceholder(tabId) {
  for (const [openerId, set] of sessions) {
    if (set.has(tabId)) return openerId;
  }
  return null;
}

// ---- úklid při zavření tabu ----
chrome.tabs.onRemoved.addListener(async (tabId) => {
  // a) zavřený opener => zruš jeho pending placeholdery
  if (sessions.has(tabId)) {
    const ids = [...sessions.get(tabId)];
    if (ids.length) chrome.tabs.remove(ids, () => void chrome.runtime.lastError);
    sessions.delete(tabId);
    return;
  }
  // b) zavřený placeholder => zruš alarm + mapu + vyhoď ze session
  await removeMapping(tabId);
  for (const [openerId, set] of sessions) {
    if (set.delete(tabId) && set.size === 0) sessions.delete(openerId);
  }
});

// když placeholder přesměruje, už to není placeholder -> zruš mapu
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (!changeInfo.url) return;
  if (!changeInfo.url.startsWith(PLACEHOLDER_URL)) {
    await removeMapping(tabId);
    for (const [openerId, set] of sessions) {
      if (set.delete(tabId) && set.size === 0) sessions.delete(openerId);
    }
  }
});

// alarmy přežívají – nic speciálního na onStartup není nutné

// ---- alarm handler: tvrdý redirect, nebo fallback vytvořit nový tab ----
chrome.alarms.onAlarm.addListener(async (alarm) => {
  const m = /^burst:(\d+)$/.exec(alarm.name);
  if (!m) return;
  const phId = parseInt(m[1], 10);
  const map = await getMap();
  const entry = map[phId];
  if (!entry) return;

  // pokus získat placeholder tab
  let ph = null;
  try { ph = await chrome.tabs.get(phId); } catch {}

  try {
    if (!ph) {
      // placeholder zmizel -> vytvoř rovnou nový cílový tab
      const props = { url: entry.url, active: false };
      if (entry.openerId) props.openerTabId = entry.openerId;
      await chrome.tabs.create(props);
    } else if (ph.discarded || ph.status === 'unloaded') {
      // byl uspán/odložen -> spolehlivě vytvoř nový tab s cílem a placeholder zavři
      const props = { url: entry.url, active: false };
      const openerId = entry.openerId || openerForPlaceholder(phId);
      if (openerId) props.openerTabId = openerId;
      await chrome.tabs.create(props);
      try { await chrome.tabs.remove(phId); } catch {}
    } else {
      // je „živý“ -> lze ho přepsat přímo na cíl
      await chrome.tabs.update(phId, { url: entry.url });
    }
  } finally {
    await removeMapping(phId);
  }
});

// ---- messaging API ----
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return;

  // downloads
  if (msg.type === "download") {
    const opts = { url: msg.url, saveAs: false, conflictAction: "uniquify" };
    if (msg.filename) opts.filename = msg.filename;
    chrome.downloads.download(opts, (id) => {
      const err = chrome.runtime.lastError;
      sendResponse(err ? { ok: false, error: err.message } : { ok: true, id });
    });
    return true;
  }

  // otevření v BG (sekvenční režim)
  if (msg.type === "openInBackground") {
    chrome.tabs.create({ url: msg.url, active: false, openerTabId: sender?.tab?.id }, (tab) => {
      const err = chrome.runtime.lastError;
      sendResponse(err ? { ok: false, error: err.message } : { ok: true, tabId: tab?.id });
    });
    return true;
  }

  // ---- burst režim: vytvoření placeholderů + plán alarmů ----
  if (msg.type === "burstOpen") {
    const openerId = sender?.tab?.id || null;
    const winId    = sender?.tab?.windowId;
    const urls     = Array.isArray(msg.urls) ? [...new Set(msg.urls)] : [];
    const stepMs   = Math.max(200, Number(msg.stepMs || 1500));
    const hardCap  = Math.min(250, urls.length);
    if (hardCap === 0) {
      sendResponse({ ok: false, error: "Nothing to open." });
      return;
    }

    const pendingSet = sessions.get(openerId) || new Set();
    sessions.set(openerId, pendingSet);
    const total = hardCap;

    urls.slice(0, hardCap).forEach((targetUrl, i) => {
      const delay = stepMs * (i + 1);
      const u = new URL(PLACEHOLDER_URL);
      u.searchParams.set("u", targetUrl);
      u.searchParams.set("d", String(delay));
      u.searchParams.set("i", String(i + 1));
      u.searchParams.set("n", String(total));

      chrome.tabs.create(
        { url: u.href, active: false, openerTabId: openerId || undefined, windowId: winId },
        async (tab) => {
          const err = chrome.runtime.lastError;
          if (err || !tab?.id) return;

          // snížit šanci na OS discard (neřeší Edge Sleeping, proto máme fallback)
          try { await chrome.tabs.update(tab.id, { autoDiscardable: false }); } catch {}

          const alarmName = `burst:${tab.id}`;
          chrome.alarms.create(alarmName, { when: Date.now() + delay });
          await addMapping(tab.id, targetUrl, alarmName, openerId || undefined);

          pendingSet.add(tab.id);
        }
      );
    });

    sendResponse({ ok: true, created: total });
    return true;
  }
});
