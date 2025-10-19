/*  ====================================================================== 
    RYCHLÉ ZKRATKY (tahák do VS Code)
      Alt+0          = Sbalit vše
      Alt+Shift+0    = Rozbalit vše
      Alt+9          = Sbalit všechny //#region bloky
      Alt+Shift+9    = Rozbalit všechny //#region bloky
      Ctrl+Alt+[     = Sbalit aktuální blok
      Ctrl+Alt+]     = Rozbalit aktuální blok
    ====================================================================== */

//#region Konstanty / globální stav
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
const GROUP_COLOR = "blue";

// --- UI locale (pro celé UI rozšíření) ---
const SUPPORTED_LOCALES = ["en", "cs"]; // můžeš rozšířit např. o "es"
const MAINT_ALARM = "kd-resort-e6-posts";
const MAINT_PERIOD_MIN = 0.25; // ~15 sekund

// Řazení A→Z / Z→A (perzistence)
const SORT_KEY = "kd_sort_dir";          // "asc" | "desc"
const SORT_DEFAULT = "asc";
let sortDirCache = SORT_DEFAULT;

// Locale pro řazení + UI (Auto/CZ/EN)
const LOCALE_KEY = "kd_sort_locale";     // "auto" | "cs" | "en"
const LOCALE_DEFAULT = "auto";
let localeCache = LOCALE_DEFAULT;
let acceptLangs = [];

// --- Burst konfigurace (nastavitelná z UI) ---
const BURST_SIZE_KEY     = "kd_burst_size";
const BURST_INTERVAL_KEY = "kd_burst_interval_ms";
const BURST_STEP_KEY     = "kd_burst_step_ms";

const BURST_SIZE_DEFAULT     = 1;     // počet placeholderů v dávce
const BURST_INTERVAL_DEFAULT = 2000;  // ms mezi dávkami (>=500)
const BURST_STEP_DEFAULT     = 1500;  // ms rozprostření uvnitř dávky (>=200)

// Průběh pro každý openerId: { total, created, opened }
const progressMap = new Map();

// Aktivní běhy (kvůli STOP): openerId -> { timer, queueLeft }
const runState = new Map();

// --- SFW filtr (doplnění ?sfw=1 do všech odkazů na e6*.net) ---
const SFW_QUERY_KEY = "sfw";
const SFW_QUERY_VALUE = "1";
//#endregion

//#region Storage helpery (mapy, nastavení)
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
  sortDirCache = (v === "desc") ? "desc" : "asc";
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
  try { await broadcastUiLocale(); } catch {}
  return val;
}

// --- Burst config get/set ---
async function loadBurstConfig() {
  const o = await chrome.storage.local.get([BURST_SIZE_KEY, BURST_INTERVAL_KEY, BURST_STEP_KEY]);
  return {
    size:       Number.isFinite(o[BURST_SIZE_KEY])     ? Math.max(1, Math.min(50, Number(o[BURST_SIZE_KEY]))) : BURST_SIZE_DEFAULT,
    intervalMs: Number.isFinite(o[BURST_INTERVAL_KEY]) ? Math.max(500, Number(o[BURST_INTERVAL_KEY]))         : BURST_INTERVAL_DEFAULT,
    stepMs:     Number.isFinite(o[BURST_STEP_KEY])     ? Math.max(200, Number(o[BURST_STEP_KEY]))             : BURST_STEP_DEFAULT,
  };
}
async function setBurstConfig({ size, intervalMs, stepMs }) {
  const payload = {};
  if (size != null)       payload[BURST_SIZE_KEY]     = Math.max(1, Math.min(50, Number(size)));
  if (intervalMs != null) payload[BURST_INTERVAL_KEY] = Math.max(500, Number(intervalMs));
  if (stepMs != null)     payload[BURST_STEP_KEY]     = Math.max(200, Number(stepMs));
  await chrome.storage.local.set(payload);
  return loadBurstConfig();
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes[SORT_KEY]) {
    sortDirCache = (changes[SORT_KEY].newValue === "desc") ? "desc" : "asc";
  }
  if (changes[LOCALE_KEY]) {
    const v = changes[LOCALE_KEY].newValue;
    localeCache = (v === "cs" || v === "en") ? v : "auto";
    broadcastUiLocale();
  }
});
//#endregion

//#region URL/API/Locale helpery
function hasTabGroupsAPI() {
  return !!(chrome.tabs?.group) && !!chrome.tabGroups;
}

// --- Host a cesty e6*.net ---
function isE6Host(hostname) {
  return /^e6[\w-]*\.net$/i.test(hostname || "");
}

// /posts přesně (listing; povolen i trailing slash a query)
function isPostsListing(u) {
  try {
    const url = new URL(u, "https://dummy.local");
    if (!isE6Host(url.hostname)) return false;
    return /^\/posts\/?$/.test(url.pathname);
  } catch {
    return false;
  }
}

// /posts/<číslo> (detail; povolen i trailing slash)
function isPostDetail(u) {
  try {
    const url = new URL(u, "https://dummy.local");
    if (!isE6Host(url.hostname)) return false;
    return /^\/posts\/\d+\/?$/.test(url.pathname);
  } catch {
    return false;
  }
}

// (historické) odpovídá include_globs ["*/posts*", "*/posts/*"] — zůstává, ale pro seskupování už NEpoužíváme
function isPostsUrl(u) {
  try {
    const url = new URL(u, "https://dummy.local");
    return /^\/posts(\/|\?|$)/.test(url.pathname);
  } catch {
    return false;
  }
}

// Je to naše placeholder stránka?
function isPlaceholderUrl(u) {
  return typeof u === "string" && u.startsWith(PLACEHOLDER_URL);
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

// ---- UI locale: vyřeš nejlepší jazyk pro UI ----
function resolveUiLocale() {
  if (localeCache && localeCache !== "auto") return localeCache; // cs|en
  const langs = (acceptLangs || []).map(x => String(x).toLowerCase());
  for (const l of langs) {
    const base = l.split("-")[0];
    if (SUPPORTED_LOCALES.includes(base)) return base;
  }
  return "en";
}
async function broadcastUiLocale() {
  const loc = resolveUiLocale();
  try {
    const tabs = await chrome.tabs.query({});
    for (const t of tabs) {
      try { chrome.tabs.sendMessage(t.id, { type: "uiLocaleChanged", locale: loc }); } catch {}
    }
  } catch {}
}
//#endregion

//#region Skupiny karet (e6 – jediná hlavní)
async function ensureSingleGroup(windowId) {
  if (!hasTabGroupsAPI()) return null;

  if (groupCache.has(windowId)) {
    const cached = groupCache.get(windowId);
    try {
      const g = await chrome.tabGroups.get(cached);
      if (g && g.windowId === windowId) return g.id;
    } catch {
      groupCache.delete(windowId);
    }
  }

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

// Seskup kartu do jediné skupiny v okně (jen když cíl je /posts/<id>)
async function groupTabIfPosts(tabId, windowId, targetUrl) {
  if (!hasTabGroupsAPI()) return null;
  if (!isPostDetail(targetUrl)) return null; // <-- jen detail, nikoli listing

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

// Dej libovolný TAB do hlavní skupiny "e6" a šoupni ho na konec skupiny
async function groupTabToMainEnd(tabId, windowId) {
  if (!hasTabGroupsAPI()) return null;

  let gid = await ensureSingleGroup(windowId);
  try {
    if (gid == null) {
      gid = await chrome.tabs.group({ tabIds: tabId });
      groupCache.set(windowId, gid);
      try { await chrome.tabGroups.update(gid, { title: GROUP_TITLE, color: GROUP_COLOR, collapsed: false }); } catch {}
    } else {
      await chrome.tabs.group({ groupId: gid, tabIds: tabId });
    }

    try {
      const inGroup = await chrome.tabs.query({ windowId, groupId: gid });
      if (inGroup.length) {
        const lastIndex = Math.max(...inGroup.map(t => t.index));
        await chrome.tabs.move(tabId, { index: lastIndex + 1 });
        await chrome.tabs.group({ groupId: gid, tabIds: tabId });
      }
    } catch {}
  } catch {
    return null;
  }
  return gid;
}

// Explicitní odskupení karty (použito pro /posts listing)
async function ensureUngrouped(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab?.groupId && tab.groupId !== -1) {
      await chrome.tabs.ungroup([tabId]);
    }
  } catch {}
}
//#endregion

//#region Řazení tabů ve skupině
function scheduleGroupSort(groupId, windowId) {
  if (!hasTabGroupsAPI()) return;
  if (groupId == null || groupId === -1) return;

  if (sortTimers.has(groupId)) clearTimeout(sortTimers.get(groupId));
  const t = setTimeout(() => { sortGroupByTitle(groupId, windowId).catch(() => {}); }, 500);
  sortTimers.set(groupId, t);
}

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
    return isPostDetail(target); // řadíme jen detaily /posts/<id>
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

async function resortAllWindows() {
  if (!hasTabGroupsAPI()) return;
  let windows = [];
  try { windows = await chrome.windows.getAll({ populate: false }); } catch { return; }
  for (const w of windows) {
    const gid = await ensureSingleGroup(w.id);
    if (gid != null) await sortGroupByTitle(gid, w.id);
  }
}
//#endregion

//#region SFW injekce (přepisovač odkazů e6*.net)
async function injectSfwLinkRewriter(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: (SFW_QUERY_KEY, SFW_QUERY_VALUE) => {
        const isE6Host = (host) => /^e6[\w-]*\.net$/i.test(host || "");

        const tagLink = (a) => {
          try {
            const href = a.getAttribute("href");
            if (!href) return;
            const u = new URL(href, location.href);
            if (!isE6Host(u.hostname)) return;

            if (u.searchParams.get(SFW_QUERY_KEY) !== SFW_QUERY_VALUE) {
              u.searchParams.set(SFW_QUERY_KEY, SFW_QUERY_VALUE);
              // zachovej relativitu, pokud byla
              if (/^https?:\/\//i.test(href)) {
                a.setAttribute("href", u.toString());
              } else {
                a.setAttribute("href", u.pathname + u.search + u.hash);
              }
            }
          } catch {}
        };

        const processAll = (root = document) => {
          root.querySelectorAll("a[href]").forEach(tagLink);
        };

        // prvotní průchod
        processAll(document);

        // dynamika (SPA / endless scroll)
        const mo = new MutationObserver((mutList) => {
          for (const m of mutList) {
            if (m.type === "childList") {
              m.addedNodes.forEach((n) => {
                if (n.nodeType === 1) {
                  if (n.tagName === "A" && n.hasAttribute("href")) {
                    tagLink(n);
                  } else {
                    processAll(n);
                  }
                }
              });
            } else if (m.type === "attributes"
                       && m.target?.tagName === "A"
                       && m.attributeName === "href") {
              tagLink(m.target);
            }
          }
        });
        mo.observe(document.documentElement, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ["href"]
        });

        // případně web může respektovat i localStorage
        try { localStorage.setItem(SFW_QUERY_KEY, SFW_QUERY_VALUE); } catch {}
      },
      args: [SFW_QUERY_KEY, SFW_QUERY_VALUE],
    });
  } catch {}
}
//#endregion

//#region Bootstrap (alarmy, menu, zkratky)
chrome.i18n?.getAcceptLanguages?.((langs) => { acceptLangs = Array.isArray(langs) ? langs : []; });

chrome.runtime.onInstalled.addListener(async () => {
  await Promise.all([loadSortDir(), loadLocale()]).catch(() => {});
  try {
    chrome.contextMenus.removeAll(() => {
      chrome.contextMenus.create({ id: "kd-sort-toggle", title: "Přepnout řazení skupiny e6 (A↔Z, 1↔9)", contexts: ["action", "page"] });
      chrome.contextMenus.create({ id: "kd-sort-asc",    title: "Řadit A → Z (1→9)", contexts: ["action", "page"] });
      chrome.contextMenus.create({ id: "kd-sort-desc",   title: "Řadit Z → A (9→1)", contexts: ["action", "page"] });

      chrome.contextMenus.create({ id: "kd-locale-header", title: "Jazyk (UI + řazení)", contexts: ["action", "page"], enabled: false });
      chrome.contextMenus.create({ id: "kd-locale-auto",   title: "Auto (podle prohlížeče)", contexts: ["action", "page"] });
      chrome.contextMenus.create({ id: "kd-locale-cs",     title: "Čeština", contexts: ["action", "page"] });
      chrome.contextMenus.create({ id: "kd-locale-en",     title: "Angličtina", contexts: ["action", "page"] });
    });
  } catch {}

  try { await broadcastUiLocale(); } catch {}
});

chrome.runtime.onStartup?.addListener(async () => {
  await loadLocale().catch(()=>{});
  await broadcastUiLocale();
});

chrome.alarms.create(MAINT_ALARM, { periodInMinutes: MAINT_PERIOD_MIN });

chrome.contextMenus?.onClicked.addListener(async (info) => {
  if (!info.menuItemId) return;

  if (info.menuItemId === "kd-sort-toggle") {
    const next = (sortDirCache === "asc") ? "desc" : "asc";
    await setSortDir(next); await resortAllWindows();
  }
  if (info.menuItemId === "kd-sort-asc")  { await setSortDir("asc");  await resortAllWindows(); }
  if (info.menuItemId === "kd-sort-desc") { await setSortDir("desc"); await resortAllWindows(); }

  if (info.menuItemId === "kd-locale-auto") { await setLocale("auto"); await resortAllWindows(); }
  if (info.menuItemId === "kd-locale-cs")   { await setLocale("cs");   await resortAllWindows(); }
  if (info.menuItemId === "kd-locale-en")   { await setLocale("en");   await resortAllWindows(); }
});

chrome.action?.onClicked.addListener(async () => {
  const next = (sortDirCache === "asc") ? "desc" : "asc";
  await setSortDir(next);
  await resortAllWindows();
});
//#endregion

//#region Události (tabs, groups, runtime)
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const map = await getMap();
  if (map[tabId]) await removeMapping(tabId);

  for (const [openerId, set] of sessions) {
    if (set.delete(tabId) && set.size === 0) sessions.delete(openerId);
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  try {
    const winId = tab?.windowId;
    if (winId == null) return;

    const current = (changeInfo.url ?? "") || tab?.url || tab?.pendingUrl || "";

    // SFW injekce pro všechny stránky na e6*.net po dokončení načtení nebo změně URL
    try {
      const u = new URL(current);
      if (isE6Host(u.hostname) && (changeInfo.status === "complete" || changeInfo.url)) {
        await injectSfwLinkRewriter(tabId);
      }
    } catch {}

    if (isPlaceholderUrl(current)) {
      await groupTabToMainEnd(tabId, winId);
      return;
    }

    // Pokud nově míří na listing /posts — výslovně odskupit
    if (changeInfo.url && isPostsListing(changeInfo.url)) {
      await ensureUngrouped(tabId);
      return;
    }

    // Pokud nově míří na detail /posts/<id> — zařadit do skupiny
    if (changeInfo.url && isPostDetail(changeInfo.url)) {
      const gid = await groupTabIfPosts(tabId, winId, changeInfo.url);
      scheduleGroupSort(gid ?? (tab.groupId ?? -1), winId);
      return;
    }

    const raw = (changeInfo.url ?? "") || tab?.pendingUrl || tab?.url || "";
    const candidateUrl = targetFromPlaceholder(raw) || raw;
    const becamePostDetail = !!changeInfo.url && isPostDetail(candidateUrl);
    const becameListing    = !!changeInfo.url && isPostsListing(candidateUrl);
    const titleArrived     = !!changeInfo.title;

    if (becameListing) {
      await ensureUngrouped(tabId);
    }

    if ((becamePostDetail || titleArrived) && isPostDetail(candidateUrl)) {
      const gid = await groupTabIfPosts(tabId, winId, candidateUrl);
      scheduleGroupSort(gid ?? (tab.groupId ?? -1), winId);
    }

    if (changeInfo.url && !isPlaceholderUrl(changeInfo.url)) {
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
    if (winId == null) return;

    // pokus o SFW injekci i při rychlé inicializaci
    try {
      const u = new URL(raw);
      if (isE6Host(u.hostname)) {
        await injectSfwLinkRewriter(tab.id);
      }
    } catch {}

    if (isPlaceholderUrl(raw)) {
      await groupTabToMainEnd(tab.id, winId);
      return;
    }

    const target = targetFromPlaceholder(raw) || raw;

    // listing /posts: nedávej do skupin
    if (isPostsListing(target)) {
      await ensureUngrouped(tab.id);
      return;
    }

    const gid = await groupTabIfPosts(tab.id, winId, target);
    scheduleGroupSort(gid ?? (tab.groupId ?? -1), winId);
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
//#endregion

//#region SPA fallback injekce (webNavigation)
(function setupWebNavigationFallback() {
  if (!chrome.webNavigation) return;

  const isE6Host = (h) => /^e6[\w-]*\.net$/i.test(h || "");
  const wantsInject = (urlStr) => {
    try {
      const u = new URL(urlStr);
      if (!isE6Host(u.hostname)) return false;
      // injektujeme na všech e6 stránkách (zvlášť /posts a /posts/<id>)
      return true;
    } catch { return false; }
  };

  const safeInject = async (tabId) => {
    try {
      await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        world: "MAIN",
        files: ["content/sfw-link-rewriter.js"]
      });
    } catch { /* no-op */ }
  };

  // Při přechodu přes History API (SPA)
  chrome.webNavigation.onHistoryStateUpdated.addListener(async (details) => {
    if (details.tabId == null) return;
    if (!wantsInject(details.url)) return;
    await safeInject(details.tabId);
  });

  // Při potvrzené navigaci (top-level i subframes)
  chrome.webNavigation.onCommitted.addListener(async (details) => {
    if (details.tabId == null) return;
    if (!wantsInject(details.url)) return;
    await safeInject(details.tabId);
  });
})();
//#endregion

//#region Alarmy (burst + údržba)
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

  const openerId = entry.openerId || openerForPlaceholder(phId) || null;

  const bumpOpened = async () => {
    if (openerId != null) {
      const st = progressMap.get(openerId);
      if (st) {
        st.opened = Math.min(st.total, (st.opened || 0) + 1);
        progressMap.set(openerId, st);
        try { await chrome.tabs.sendMessage(openerId, { type: "burstProgress", total: st.total, created: st.created || 0, opened: st.opened }); } catch {}
        if (st.opened >= st.total) {
          try { await chrome.tabs.sendMessage(openerId, { type: "burstDone", total: st.total }); } catch {}
          progressMap.delete(openerId);
          sessions.delete(openerId);
          runState.delete(openerId);
        }
      }
    }
  };

  try {
    if (!ph) {
      const created = await chrome.tabs.create({ url: entry.url, active: false, openerTabId: openerId || undefined });
      if (created?.id != null && created.windowId != null && isPostDetail(entry.url)) {
        const gid = await groupTabIfPosts(created.id, created.windowId, entry.url);
        scheduleGroupSort(gid ?? (created.groupId ?? -1), created.windowId);
      } else if (created?.id != null) {
        try { const u = new URL(entry.url); if (isE6Host(u.hostname)) await injectSfwLinkRewriter(created.id); } catch {}
      }
      await bumpOpened();
    } else if (ph.discarded || ph.status === "unloaded") {
      const created = await chrome.tabs.create({ url: entry.url, active: false, openerTabId: openerId || undefined });
      try { await chrome.tabs.remove(phId); } catch {}
      if (created?.id != null && created.windowId != null && isPostDetail(entry.url)) {
        const gid = await groupTabIfPosts(created.id, created.windowId, entry.url);
        scheduleGroupSort(gid ?? (created.groupId ?? -1), created.windowId);
      } else if (created?.id != null) {
        try { const u = new URL(entry.url); if (isE6Host(u.hostname)) await injectSfwLinkRewriter(created.id); } catch {}
      }
      await bumpOpened();
    } else {
      await chrome.tabs.update(phId, { url: entry.url });
      try { const u = new URL(entry.url); if (isE6Host(u.hostname)) await injectSfwLinkRewriter(phId); } catch {}
      await bumpOpened();
    }
  } finally {
    await removeMapping(phId);
  }
});
//#endregion

//#region Pomocné: STOP běhu
async function stopBurstFor(openerId) {
  const st = runState.get(openerId);
  if (st?.timer) {
    try { clearInterval(st.timer); } catch {}
  }
  runState.delete(openerId);

  // Zruš alarmy + zavři placeholdery napojené na tohoto openerId
  const map = await getMap();
  const toDelete = [];
  for (const [tabIdStr, entry] of Object.entries(map)) {
    if (entry?.openerId === openerId) {
      if (entry.alarmName) {
        try { await chrome.alarms.clear(entry.alarmName); } catch {}
      }
      try {
        const tid = Number(tabIdStr);
        const t = await chrome.tabs.get(tid).catch(()=>null);
        if (t && isPlaceholderUrl(t.url || t.pendingUrl || "")) {
          await chrome.tabs.remove(tid).catch(()=>{});
        }
      } catch {}
      toDelete.push(tabIdStr);
    }
  }
  for (const id of toDelete) delete map[id];
  await setMap(map);

  sessions.delete(openerId);
  progressMap.delete(openerId);
  try { await chrome.tabs.sendMessage(openerId, { type: "burstDone", total: 0 }); } catch {}
}
//#endregion

//#region Messaging API (UI, hotkeys)
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

  if (msg.type === "getUiLocale") {
    sendResponse({ ok: true, locale: resolveUiLocale() });
    return true;
  }

  // Burst konfigurace
  if (msg.type === "getBurstConfig") {
    loadBurstConfig()
      .then(cfg => sendResponse({ ok: true, config: cfg }))
      .catch(err => sendResponse({ ok: false, error: String(err) }));
    return true;
  }
  if (msg.type === "setBurstConfig") {
    setBurstConfig({ size: msg.size, intervalMs: msg.intervalMs, stepMs: msg.stepMs })
      .then(cfg => sendResponse({ ok: true, config: cfg }))
      .catch(err => sendResponse({ ok: false, error: String(err) }));
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
          if (isPostDetail(msg.url)) {
            const gid = await groupTabIfPosts(tab.id, winId, msg.url);
            scheduleGroupSort(gid ?? (tab.groupId ?? -1), winId);
          } else if (isPostsListing(msg.url)) {
            await ensureUngrouped(tab.id); // listing neřadit
          } else {
            await groupTabToMainEnd(tab.id, winId);
          }
          // SFW injekce pro e6 host
          try { const u = new URL(msg.url); if (isE6Host(u.hostname)) await injectSfwLinkRewriter(tab.id); } catch {}
        } catch {}
      }
    });
    return true;
  }

  // --- HROMADNÉ OTEVÍRÁNÍ (sekvenční režim odstraněn) ---
  if (msg.type === "burstOpen") {
    const openerId = sender?.tab?.id || null;
    const winId    = sender?.tab?.windowId;

    const urlsRaw  = Array.isArray(msg.urls) ? msg.urls : [];
    const urls     = [...new Set(urlsRaw)];
    const hardCap  = Math.min(250, urls.length);
    if (hardCap === 0) { sendResponse({ ok: false, error: "Nothing to open." }); return true; }

    loadBurstConfig().then((cfg) => {
      const stepMs            = Math.max(200, Number(msg.stepMs            ?? cfg.stepMs));
      const BATCH_SIZE        = Math.max(1,  Math.min(50, Number(msg.batchSize        ?? cfg.size)));
      const BATCH_INTERVAL_MS = Math.max(500,         Number(msg.batchIntervalMs ?? cfg.intervalMs));

      const queue = urls.slice(0, hardCap);
      const total = queue.length;

      const pendingSet = sessions.get(openerId) || new Set();
      sessions.set(openerId, pendingSet);

      progressMap.set(openerId, { total, created: 0, opened: 0 });
      try { chrome.tabs.sendMessage(openerId, { type: "burstProgress", total, created: 0, opened: 0 }); } catch {}

      let timer = null;

      const openOneBatch = () => {
        if (!queue.length) {
          if (timer) { clearInterval(timer); timer = null; }
          runState.delete(openerId);
          return;
        }

        let inBatch = 0;
        while (inBatch < BATCH_SIZE && queue.length) {
          const targetUrl = queue.shift();

          const st = progressMap.get(openerId) || { total, created: 0, opened: 0 };
          const ordinal = (st.created || 0) + 1;

          const ph = new URL(PLACEHOLDER_URL);
          ph.searchParams.set("u", String(targetUrl));
          ph.searchParams.set("i", String(ordinal));
          ph.searchParams.set("n", String(total));

          const perDelay = stepMs * (inBatch + 1);
          ph.searchParams.set("d", String(perDelay));

          chrome.tabs.create(
            { url: ph.href, active: false, openerTabId: openerId || undefined, windowId: winId },
            async (tab) => {
              const err = chrome.runtime.lastError;
              if (err || !tab?.id) return;

              try { await chrome.tabs.update(tab.id, { autoDiscardable: true }); } catch {}
              const alarmName = `burst:${tab.id}`;
              chrome.alarms.create(alarmName, { when: Date.now() + perDelay });

              try { await addMapping(tab.id, targetUrl, alarmName, openerId || undefined); } catch {}
              pendingSet.add(tab.id);

              if (winId != null) {
                try { await groupTabToMainEnd(tab.id, winId); } catch {}
              }

              const now = progressMap.get(openerId) || { total, created: 0, opened: 0 };
              now.created = Math.min(now.total, (now.created || 0) + 1);
              progressMap.set(openerId, now);
              try { await chrome.tabs.sendMessage(openerId, { type: "burstProgress", total: now.total, created: now.created, opened: now.opened || 0 }); } catch {}
            }
          );

        inBatch++;
        }

        runState.set(openerId, { timer, queueLeft: queue.length });

        if (!queue.length && timer) {
          clearInterval(timer);
          runState.delete(openerId);
          timer = null;
        }
      };

      openOneBatch();
      timer = setInterval(openOneBatch, BATCH_INTERVAL_MS);
      runState.set(openerId, { timer, queueLeft: queue.length });

      sendResponse({
        ok: true,
        enqueued: total,
        batchSize: BATCH_SIZE,
        batchIntervalMs: BATCH_INTERVAL_MS,
        stepMs
      });
    }).catch(err => sendResponse({ ok: false, error: String(err) }));
    return true;
  }

  // STOP aktuálního běhu pro daný opener (tab, ze kterého se spouštělo)
  if (msg.type === "burstStop") {
    const openerId = sender?.tab?.id || null;
    if (!openerId) { sendResponse({ ok:false, error:"no opener" }); return true; }
    stopBurstFor(openerId).then(()=> sendResponse({ ok:true }))
                          .catch(err => sendResponse({ ok:false, error:String(err) }));
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
//#endregion

//#region Klávesové příkazy
chrome.commands?.onCommand.addListener(async (command) => {
  if (command === "toggle-sort") {
    const next = (sortDirCache === "asc") ? "desc" : "asc";
    await setSortDir(next);
    await resortAllWindows();
  }
  if (command === "toggle-locale") {
    const next = localeCache === "auto" ? "cs" : (localeCache === "cs" ? "en" : "auto");
    await setLocale(next);
    await resortAllWindows();
  }
});
//#endregion
