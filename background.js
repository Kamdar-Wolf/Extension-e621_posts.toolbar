// background.js

// ============= konstanty / globální stav =============
const PLACEHOLDER_URL = chrome.runtime.getURL("placeholder.html");

// Úložiště pro mapování placeholder -> cílová URL (burst režim)
const MAP_KEY = "kd_burst_map"; // { [tabId]: { url, alarmName, openerId? } }

// openerTabId -> Set<pendingPlaceholderTabId>
const sessions = new Map();
// windowId -> tabGroupId (jediná skupina "e6" v daném okně)
const groupCache = new Map();
// groupId -> debounce časovač pro řazení
const sortTimers = new Map();

// Vzhled skupiny (barvy: "blue","red","yellow","green","pink","purple","cyan","orange","grey")
const GROUP_TITLE = "e6";
const GROUP_COLOR = "blue"; // „královská modř“ v UI tečkách

// Pravidelné přerovnání (pro jistotu)
const MAINT_ALARM = "kd-resort-e6-posts";
const MAINT_PERIOD_MIN = 0.25; // ~15 sekund

// Řazení A→Z / Z→A (perzistence)
const SORT_KEY = "kd_sort_dir";          // "asc" | "desc"
const SORT_DEFAULT = "asc";
let sortDirCache = SORT_DEFAULT;

// Locale pro řazení (Auto/CZ/EN)
const LOCALE_KEY = "kd_sort_locale";     // "auto" | "cs" | "en"
const LOCALE_DEFAULT = "auto";
let localeCache = LOCALE_DEFAULT;        // aktuální volba
let acceptLangs = [];                    // seznam jazyků z prohlížeče (pro Auto)

// ============= pomocné funkce: storage =============
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
  if (entry?.alarmName) {
    try { await chrome.alarms.clear(entry.alarmName); } catch {}
  }
  delete map[tabId];
  await setMap(map);
}

async function loadSortDir() {
  const o = await chrome.storage.local.get(SORT_KEY);
  const v = (o[SORT_KEY] || SORT_DEFAULT);
  sortDirCache = (v === "desc" ? "desc" : "asc");
  return sortDirCache;
}
async function setSortDir(dir) {
  const v = (dir === "desc") ? "desc" : "asc";
  sortDirCache = v;
  await chrome.storage.local.set({ [SORT_KEY]: v });
  return v;
}

async function loadLocale() {
  const o = await chrome.storage.local.get(LOCALE_KEY);
  const v = (o[LOCALE_KEY] || LOCALE_DEFAULT);
  localeCache = (v === "cs" || v === "en") ? v : "auto";
  return localeCache;
}
async function setLocale(v) {
  const val = (v === "cs" || v === "en") ? v : "auto";
  localeCache = val;
  await chrome.storage.local.set({ [LOCALE_KEY]: val });
  return val;
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes[SORT_KEY]) {
    sortDirCache = (changes[SORT_KEY].newValue === "desc") ? "desc" : "asc";
  }
  if (changes[LOCALE_KEY]) {
    const v = changes[LOCALE_KEY].newValue;
    localeCache = (v === "cs" || v === "en") ? v : "auto";
  }
});

// ============= pomocné: URL / API / locale =============
function hasTabGroupsAPI() {
  return !!(chrome.tabs?.group) && !!chrome.tabGroups;
}

// Odpovídá include_globs ["*/posts*", "*/posts/*"]
function isPostsUrl(u) {
  try {
    const url = new URL(u, "https://dummy.local");
    return /^\/posts(\/|\?|$)/.test(url.pathname);
  } catch {
    return false;
  }
}

// Vytáhni cílovou URL z placeholderu (burst)
function targetFromPlaceholder(rawUrl) {
  try {
    const u = new URL(rawUrl);
    if (u.href.startsWith(PLACEHOLDER_URL)) {
      const tgt = u.searchParams.get("u");
      if (tgt) return tgt;
    }
  } catch {}
  return null;
}

function openerForPlaceholder(tabId) {
  for (const [openerId, set] of sessions) {
    if (set.has(tabId)) return openerId;
  }
  return null;
}

// Vytvoř collator dle volby jazyka
function getCollator() {
  let locales = undefined;
  if (localeCache === "cs") locales = ["cs"];
  else if (localeCache === "en") locales = ["en"];
  else locales = acceptLangs.length ? acceptLangs : undefined;

  return new Intl.Collator(locales, {
    numeric: true,
    sensitivity: "base",
    ignorePunctuation: true
  });
}

// ============= práce se skupinou =============
async function ensureSingleGroup(windowId) {
  if (!hasTabGroupsAPI()) return null;

  // cache (a ověřit existenci)
  if (groupCache.has(windowId)) {
    const cached = groupCache.get(windowId);
    try {
      const g = await chrome.tabGroups.get(cached);
      if (g && g.windowId === windowId) return g.id;
    } catch {
      groupCache.delete(windowId);
    }
  }

  // najít podle názvu
  try {
    const groups = await chrome.tabGroups.query({ windowId });
    const hit = groups.find(g => (g.title || "").toLowerCase() === GROUP_TITLE);
    if (hit) {
      groupCache.set(windowId, hit.id);
      return hit.id;
    }
  } catch {}

  return null; // vytvoří se při prvním seskupení
}

// Seskup kartu do jediné skupiny v okně (jen když cíl je /posts*)
async function groupTabIfPosts(tabId, windowId, targetUrl) {
  if (!hasTabGroupsAPI()) return null;
  if (!isPostsUrl(targetUrl)) return null;

  let gid = await ensureSingleGroup(windowId);
  try {
    if (gid != null) {
      await chrome.tabs.group({ groupId: gid, tabIds: tabId });
    } else {
      gid = await chrome.tabs.group({ tabIds: tabId });
      groupCache.set(windowId, gid);
      try {
        await chrome.tabGroups.update(gid, { title: GROUP_TITLE, color: GROUP_COLOR, collapsed: false });
      } catch {}
    }
  } catch {
    return null;
  }
  scheduleGroupSort(gid, windowId);
  return gid;
}

// ============= řazení =============
function scheduleGroupSort(groupId, windowId) {
  if (!hasTabGroupsAPI()) return;
  if (groupId == null || groupId === -1) return;

  if (sortTimers.has(groupId)) clearTimeout(sortTimers.get(groupId));
  const t = setTimeout(() => { sortGroupByTitle(groupId, windowId).catch(() => {}); }, 500);
  sortTimers.set(groupId, t);
}

// Seřaď uvnitř skupiny jen /posts* karty dle title/url, A→Z nebo Z→A a dle zvoleného jazyka
async function sortGroupByTitle(groupId, windowId) {
  if (!hasTabGroupsAPI() || groupId == null || groupId === -1) return;

  const dir = sortDirCache || await loadSortDir();

  let tabs = [];
  try { tabs = await chrome.tabs.query({ windowId, groupId }); } catch { return; }
  if (!tabs.length) return;

  const postsTabs = tabs.filter(t => {
    const raw = t.pendingUrl || t.url || "";
    const fromPH = targetFromPlaceholder(raw);
    const target = fromPH || raw;
    return isPostsUrl(target);
  });
  if (postsTabs.length < 2) return;

  const baseIndex = Math.min(...postsTabs.map(t => t.index));
  const collator = getCollator();
  const key = (t) => (t.title || t.pendingUrl || t.url || "").trim();
  const mul = (dir === "desc") ? -1 : 1;
  const desired = [...postsTabs].sort((a, b) => mul * collator.compare(key(a), key(b)));

  for (let i = 0; i < desired.length; i++) {
    try { await chrome.tabs.move(desired[i].id, { index: baseIndex + i }); } catch {}
  }
}

// Přerovnej ve všech oknech (periodická údržba)
async function resortAllWindows() {
  if (!hasTabGroupsAPI()) return;
  let windows = [];
  try { windows = await chrome.windows.getAll({ populate: false }); } catch { return; }
  for (const w of windows) {
    const gid = await ensureSingleGroup(w.id);
    if (gid != null) await sortGroupByTitle(gid, w.id);
  }
}

// ============= bootstrap: alarmy, menu, zkratky =============
// sběr jazyků pro „Auto“
chrome.i18n?.getAcceptLanguages?.((langs) => { acceptLangs = Array.isArray(langs) ? langs : []; });

// inicializace
chrome.runtime.onInstalled.addListener(async () => {
  await Promise.all([loadSortDir(), loadLocale()]).catch(() => {});
  try {
    chrome.contextMenus.removeAll(() => {
      // přepnutí směru
      chrome.contextMenus.create({
        id: "kd-sort-toggle",
        title: "Přepnout řazení skupiny e6 (A↔Z, 1↔9)",
        contexts: ["action", "page"]
      });
      chrome.contextMenus.create({
        id: "kd-sort-asc",
        title: "Řadit A → Z (1→9)",
        contexts: ["action", "page"]
      });
      chrome.contextMenus.create({
        id: "kd-sort-desc",
        title: "Řadit Z → A (9→1)",
        contexts: ["action", "page"]
      });

      // volba jazyka řazení
      chrome.contextMenus.create({
        id: "kd-locale-header",
        title: "Jazyk řazení",
        contexts: ["action", "page"],
        enabled: false
      });
      chrome.contextMenus.create({
        id: "kd-locale-auto",
        title: "Auto (podle prohlížeče)",
        contexts: ["action", "page"]
      });
      chrome.contextMenus.create({
        id: "kd-locale-cs",
        title: "Čeština",
        contexts: ["action", "page"]
      });
      chrome.contextMenus.create({
        id: "kd-locale-en",
        title: "Angličtina",
        contexts: ["action", "page"]
      });
    });
  } catch {}
});

// periodický alarm
chrome.alarms.create(MAINT_ALARM, { periodInMinutes: MAINT_PERIOD_MIN });

// reakce na menu
chrome.contextMenus?.onClicked.addListener(async (info) => {
  if (!info.menuItemId) return;

  // směr
  if (info.menuItemId === "kd-sort-toggle") {
    const next = (sortDirCache === "asc") ? "desc" : "asc";
    await setSortDir(next);
    await resortAllWindows();
  }
  if (info.menuItemId === "kd-sort-asc") {
    await setSortDir("asc"); await resortAllWindows();
  }
  if (info.menuItemId === "kd-sort-desc") {
    await setSortDir("desc"); await resortAllWindows();
  }

  // locale
  if (info.menuItemId === "kd-locale-auto") {
    await setLocale("auto"); await resortAllWindows();
  }
  if (info.menuItemId === "kd-locale-cs") {
    await setLocale("cs"); await resortAllWindows();
  }
  if (info.menuItemId === "kd-locale-en") {
    await setLocale("en"); await resortAllWindows();
  }
});

// klik na ikonu rozšíření (když není popup) → přepnout A↔Z
chrome.action?.onClicked.addListener(async () => {
  const next = (sortDirCache === "asc") ? "desc" : "asc";
  await setSortDir(next);
  await resortAllWindows();
});

// ============= životní cyklus / události =============
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const map = await getMap();
  if (map[tabId]) await removeMapping(tabId);

  for (const [openerId, set] of sessions) {
    if (set.delete(tabId) && set.size === 0) sessions.delete(openerId);
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  try {
    const raw = (changeInfo.url ?? "") || tab?.pendingUrl || tab?.url || "";
    const candidateUrl = targetFromPlaceholder(raw) || raw;

    const becamePosts = !!changeInfo.url && isPostsUrl(candidateUrl);
    const titleArrived = !!changeInfo.title;

    if ((becamePosts || titleArrived) && tab?.windowId != null) {
      const gid = await groupTabIfPosts(tabId, tab.windowId, candidateUrl);
      scheduleGroupSort(gid ?? (tab.groupId ?? -1), tab.windowId);
    }

    if (changeInfo.url && !changeInfo.url.startsWith(PLACEHOLDER_URL)) {
      await removeMapping(tabId);
      for (const [openerId, set] of sessions) {
        if (set.delete(tabId) && set.size === 0) sessions.delete(openerId);
      }
    }
  } catch {}
});

chrome.tabs.onCreated.addListener(async (tab) => {
  try {
    const winId = tab.windowId;
    const raw = tab.pendingUrl || tab.url || "";
    const target = targetFromPlaceholder(raw) || raw;
    if (winId != null) {
      const gid = await groupTabIfPosts(tab.id, winId, target);
      scheduleGroupSort(gid ?? (tab.groupId ?? -1), winId);
    }
  } catch {}
});

chrome.tabs.onMoved.addListener(async (tabId) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab.groupId !== -1 && tab.windowId != null) {
      const gid = await ensureSingleGroup(tab.windowId);
      if (gid != null && gid === tab.groupId) scheduleGroupSort(gid, tab.windowId);
    }
  } catch {}
});

chrome.tabs.onAttached.addListener(async (tabId, attachInfo) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab?.groupId !== -1) scheduleGroupSort(tab.groupId, attachInfo.newWindowId);
  } catch {}
});
chrome.tabs.onDetached.addListener(() => {});

if (chrome.tabGroups?.onUpdated) {
  chrome.tabGroups.onUpdated.addListener(async (group) => {
    if ((group.title || "").toLowerCase() === GROUP_TITLE) {
      groupCache.set(group.windowId, group.id);
      scheduleGroupSort(group.id, group.windowId);
    }
  });
}

// ============= budíky: burst placeholdery + údržba =============
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === MAINT_ALARM) {
    await resortAllWindows();
    return;
  }

  const m = /^burst:(\d+)$/.exec(alarm.name);
  if (!m) return;
  const phId = parseInt(m[1], 10);
  const map = await getMap();
  const entry = map[phId];
  if (!entry) return;

  let ph = null;
  try { ph = await chrome.tabs.get(phId); } catch {}

  try {
    if (!ph) {
      const created = await chrome.tabs.create({ url: entry.url, active: false, openerTabId: entry.openerId || undefined });
      if (created?.id != null && created.windowId != null) {
        const gid = await groupTabIfPosts(created.id, created.windowId, entry.url);
        scheduleGroupSort(gid ?? (created.groupId ?? -1), created.windowId);
      }
    } else if (ph.discarded || ph.status === "unloaded") {
      const created = await chrome.tabs.create({ url: entry.url, active: false, openerTabId: entry.openerId || openerForPlaceholder(phId) || undefined });
      try { await chrome.tabs.remove(phId); } catch {}
      if (created?.id != null && created.windowId != null) {
        const gid = await groupTabIfPosts(created.id, created.windowId, entry.url);
        scheduleGroupSort(gid ?? (created.groupId ?? -1), created.windowId);
      }
    } else {
      await chrome.tabs.update(phId, { url: entry.url });
      if (ph.windowId != null) {
        const gid = await groupTabIfPosts(phId, ph.windowId, entry.url);
        scheduleGroupSort(gid ?? (ph.groupId ?? -1), ph.windowId);
      }
    }
  } finally {
    await removeMapping(phId);
  }
});

// ============= messaging API (pro UI / hotkeys) =============
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
    const openerId = sender?.tab?.id;
    const winId = sender?.tab?.windowId;
    chrome.tabs.create({ url: msg.url, active: false, openerTabId: openerId }, async (tab) => {
      const err = chrome.runtime.lastError;
      const ok = !err && tab?.id != null;
      sendResponse(ok ? { ok: true, tabId: tab.id } : { ok: false, error: err?.message || "create failed" });
      if (ok && winId != null) {
        try {
          const gid = await groupTabIfPosts(tab.id, winId, msg.url);
          scheduleGroupSort(gid ?? (tab.groupId ?? -1), winId);
        } catch {}
      }
    });
    return true;
  }

  if (msg.type === "burstOpen") {
    const openerId = sender?.tab?.id || null;
    const winId    = sender?.tab?.windowId;
    const urls     = Array.isArray(msg.urls) ? [...new Set(msg.urls)] : [];
    const stepMs   = Math.max(200, Number(msg.stepMs || 1500));
    const hardCap  = Math.min(250, urls.length);
    if (hardCap === 0) { sendResponse({ ok: false, error: "Nothing to open." }); return true; }

    const pendingSet = sessions.get(openerId) || new Set();
    sessions.set(openerId, pendingSet);
    const total = hardCap;

    urls.slice(0, hardCap).forEach((targetUrl, i) => {
      const delay = stepMs * (i + 1);
      const ph = new URL(PLACEHOLDER_URL);
      ph.searchParams.set("u", targetUrl);
      ph.searchParams.set("d", String(delay));
      ph.searchParams.set("i", String(i + 1));
      ph.searchParams.set("n", String(total));

      chrome.tabs.create(
        { url: ph.href, active: false, openerTabId: openerId || undefined, windowId: winId },
        async (tab) => {
          const err = chrome.runtime.lastError;
          if (err || !tab?.id) return;

          try { await chrome.tabs.update(tab.id, { autoDiscardable: false }); } catch {}
          const alarmName = `burst:${tab.id}`;
          chrome.alarms.create(alarmName, { when: Date.now() + delay });
          await addMapping(tab.id, targetUrl, alarmName, openerId || undefined);
          pendingSet.add(tab.id);

          if (winId != null) {
            try {
              const gid = await groupTabIfPosts(tab.id, winId, targetUrl);
              scheduleGroupSort(gid ?? (tab.groupId ?? -1), winId);
            } catch {}
          }
        }
      );
    });

    sendResponse({ ok: true, created: total });
    return true;
  }

  if (msg.type === "setSortOrder") {
    const v = (msg.dir === "desc") ? "desc" : "asc";
    setSortDir(v).then(async (dir) => {
      await resortAllWindows();
      sendResponse({ ok: true, dir });
    }).catch(err => sendResponse({ ok: false, error: String(err) }));
    return true;
  }
  if (msg.type === "getSortOrder") {
    loadSortDir().then(dir => sendResponse({ ok: true, dir }))
      .catch(err => sendResponse({ ok: false, error: String(err) }));
    return true;
  }

  if (msg.type === "setSortLocale") {
    const v = (msg.locale === "cs" || msg.locale === "en") ? msg.locale : "auto";
    setLocale(v).then(async (loc) => {
      await resortAllWindows();
      sendResponse({ ok: true, locale: loc });
    }).catch(err => sendResponse({ ok: false, error: String(err) }));
    return true;
  }
  if (msg.type === "getSortLocale") {
    loadLocale().then(loc => sendResponse({ ok: true, locale: loc }))
      .catch(err => sendResponse({ ok: false, error: String(err) }));
    return true;
  }
});

// ============= klávesové příkazy (nastav v edge://extensions/shortcuts) =============
chrome.commands?.onCommand.addListener(async (command) => {
  if (command === "toggle-sort") {
    const next = (sortDirCache === "asc") ? "desc" : "asc";
    await setSortDir(next);
    await resortAllWindows();
  }
  if (command === "toggle-locale") {
    // cyklus: auto -> cs -> en -> auto ...
    const next = localeCache === "auto" ? "cs" : (localeCache === "cs" ? "en" : "auto");
    await setLocale(next);
    await resortAllWindows();
  }
});
