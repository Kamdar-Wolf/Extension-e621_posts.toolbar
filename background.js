// background.js (MV3 service worker)
// Goal: Always group *both* sequential and burst-opened /posts* tabs into ONE group per window
// and keep them auto-sorted by tab title at all times (self-healing if moved/closed/restored).

// ============= constants / globals =============
const PLACEHOLDER_URL = chrome.runtime.getURL("placeholder.html");

// Storage key for burst placeholders -> targets
const MAP_KEY = "kd_burst_map"; // { [tabId]: { url, alarmName, openerId? } }

// openerTabId -> Set<pendingPlaceholderTabId>
const sessions = new Map();
// windowId -> tabGroupId (the single "e6" group in that window)
const groupCache = new Map();
// groupId -> debounce timer for sorting
const sortTimers = new Map();

// cosmetics
const GROUP_TITLE = "e6";
const GROUP_COLOR = "blue";

// maintenance alarm (periodic resort to be bulletproof)
const MAINT_ALARM = "kd-resort-e6-posts";
const MAINT_PERIOD_MIN = 0.25; // every 15 seconds

// ============= helpers: storage =============
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
function openerForPlaceholder(tabId) {
  for (const [openerId, set] of sessions) {
    if (set.has(tabId)) return openerId;
  }
  return null;
}

// ============= helpers: url / api checks =============
function hasTabGroupsAPI() {
  return !!(chrome.tabs?.group) && !!chrome.tabGroups;
}

// Match include_globs ["*/posts*", "*/posts/*"]
function isPostsUrl(u) {
  try {
    const url = new URL(u, "https://dummy.local");
    // pure path check; "*/posts*" and "*/posts/*" both start with /posts
    return /^\/posts(\/|\?|$)/.test(url.pathname);
  } catch {
    return false;
  }
}

// Extract intended target from placeholder
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

// ============= grouping =============
async function ensureSingleGroup(windowId) {
  if (!hasTabGroupsAPI()) return null;

  // Use cache if still valid
  if (groupCache.has(windowId)) {
    const cached = groupCache.get(windowId);
    try {
      const g = await chrome.tabGroups.get(cached);
      if (g && g.windowId === windowId) return g.id;
    } catch {
      groupCache.delete(windowId);
    }
  }

  // Try to find by title
  try {
    const groups = await chrome.tabGroups.query({ windowId });
    const hit = groups.find(g => (g.title || "").toLowerCase() === GROUP_TITLE);
    if (hit) {
      groupCache.set(windowId, hit.id);
      return hit.id;
    }
  } catch {}

  return null; // will be created when we actually group a tab
}

// Group a tab if its TARGET is /posts*
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
        await chrome.tabGroups.update(gid, {
          title: GROUP_TITLE,
          color: GROUP_COLOR,
          collapsed: false
        });
      } catch {}
    }
  } catch {
    return null;
  }
  // schedule a sort
  scheduleGroupSort(gid, windowId);
  return gid;
}

// ============= sorting (title) =============
// Debounced sorting per group
function scheduleGroupSort(groupId, windowId) {
  if (!hasTabGroupsAPI()) return;
  if (groupId == null || groupId === -1) return;

  if (sortTimers.has(groupId)) clearTimeout(sortTimers.get(groupId));
  const t = setTimeout(() => {
    sortGroupByTitle(groupId, windowId).catch(() => {});
  }, 500);
  sortTimers.set(groupId, t);
}

// Sort only /posts* tabs within the group by (title || url), case-insensitive, numeric
async function sortGroupByTitle(groupId, windowId) {
  if (!hasTabGroupsAPI() || groupId == null || groupId === -1) return;
  let tabs = [];
  try {
    tabs = await chrome.tabs.query({ windowId, groupId });
  } catch { return; }
  if (!tabs.length) return;

  // Only /posts* tabs are managed
  const postsTabs = tabs.filter(t => {
    const raw = t.pendingUrl || t.url || "";
    // if this is a placeholder, consider its target instead
    const fromPH = targetFromPlaceholder(raw);
    const target = fromPH || raw;
    return isPostsUrl(target);
  });
  if (postsTabs.length < 2) return;

  // Base slot = smallest index among the managed tabs
  const baseIndex = Math.min(...postsTabs.map(t => t.index));

  // Natural, case-insensitive compare on (title || url)
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
  const key = (t) => (t.title || t.pendingUrl || t.url || "").trim();

  const desired = [...postsTabs].sort((a, b) => collator.compare(key(a), key(b)));

  // Move each tab to consecutive indices (Chrome preserves relative order of others)
  for (let i = 0; i < desired.length; i++) {
    const id = desired[i].id;
    try { await chrome.tabs.move(id, { index: baseIndex + i }); } catch {}
  }
}

// Resort all known groups across all windows (periodic maintenance)
async function resortAllWindows() {
  if (!hasTabGroupsAPI()) return;
  let windows = [];
  try { windows = await chrome.windows.getAll({ populate: false }); } catch { return; }
  for (const w of windows) {
    const gid = await ensureSingleGroup(w.id);
    if (gid != null) await sortGroupByTitle(gid, w.id);
  }
}

// Ensure maintenance alarm exists
chrome.alarms.create(MAINT_ALARM, { periodInMinutes: MAINT_PERIOD_MIN });

// ============= lifecycle & events =============

// Close/cleanup placeholder state on tab removal
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const map = await getMap();
  if (map[tabId]) await removeMapping(tabId);

  for (const [openerId, set] of sessions) {
    if (set.delete(tabId) && set.size === 0) sessions.delete(openerId);
  }
});

// Group-and-sort for any /posts* tab that appears or changes title/url
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  try {
    // If this tab is (or becomes) a /posts* tab, group it and sort
    const raw = (changeInfo.url ?? "") || tab?.pendingUrl || tab?.url || "";
    const candidateUrl = targetFromPlaceholder(raw) || raw;

    const becamePosts = !!changeInfo.url && isPostsUrl(candidateUrl);
    const titleArrived = !!changeInfo.title;

    if ((becamePosts || titleArrived) && tab?.windowId != null) {
      const gid = await groupTabIfPosts(tabId, tab.windowId, candidateUrl);
      scheduleGroupSort(gid ?? (tab.groupId ?? -1), tab.windowId);
    }

    // If placeholder navigated away, cleanup mapping
    if (changeInfo.url && !changeInfo.url.startsWith(PLACEHOLDER_URL)) {
      await removeMapping(tabId);
      for (const [openerId, set] of sessions) {
        if (set.delete(tabId) && set.size === 0) sessions.delete(openerId);
      }
    }
  } catch {}
});

// Any new tab (manual, sequential, placeholder, restored) -> group+sort if /posts*
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

// If a tab is moved (even by the user), snap it back by title ordering shortly after
chrome.tabs.onMoved.addListener(async (tabId, moveInfo) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab.groupId !== -1 && tab.windowId != null) {
      // only enforce for our group
      const gid = await ensureSingleGroup(tab.windowId);
      if (gid != null && gid === tab.groupId) {
        scheduleGroupSort(gid, tab.windowId);
      }
    }
  } catch {}
});

// When a tab gets attached to a window or a group changes, re-sort
chrome.tabs.onAttached.addListener(async (tabId, attachInfo) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab?.groupId !== -1) scheduleGroupSort(tab.groupId, attachInfo.newWindowId);
  } catch {}
});
chrome.tabs.onDetached.addListener(async (tabId, detachInfo) => {
  // Detach breaks grouping; no action needed here
});

// If a tab is grouped/ungrouped externally, keep order
if (chrome.tabGroups?.onUpdated) {
  chrome.tabGroups.onUpdated.addListener(async (group) => {
    // When our group's title/color changes or it gets recreated, refresh cache & sort
    if ((group.title || "").toLowerCase() === GROUP_TITLE) {
      groupCache.set(group.windowId, group.id);
      scheduleGroupSort(group.id, group.windowId);
    }
  });
}

// ============= alarms: burst placeholders + maintenance =============
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
      // placeholder disappeared – create the real tab
      const created = await chrome.tabs.create({
        url: entry.url,
        active: false,
        openerTabId: entry.openerId || undefined
      });
      if (created?.id != null && created.windowId != null) {
        const gid = await groupTabIfPosts(created.id, created.windowId, entry.url);
        scheduleGroupSort(gid ?? (created.groupId ?? -1), created.windowId);
      }
    } else if (ph.discarded || ph.status === "unloaded") {
      // placeholder was discarded – create fresh target and close placeholder
      const created = await chrome.tabs.create({
        url: entry.url,
        active: false,
        openerTabId: entry.openerId || openerForPlaceholder(phId) || undefined
      });
      try { await chrome.tabs.remove(phId); } catch {}
      if (created?.id != null && created.windowId != null) {
        const gid = await groupTabIfPosts(created.id, created.windowId, entry.url);
        scheduleGroupSort(gid ?? (created.groupId ?? -1), created.windowId);
      }
    } else {
      // reuse the placeholder tab: navigate to target, then group+sort
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

// ============= messaging API (used by your UI/content) =============
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return;

  // File downloads passthrough
  if (msg.type === "download") {
    const opts = { url: msg.url, saveAs: false, conflictAction: "uniquify" };
    if (msg.filename) opts.filename = msg.filename;
    chrome.downloads.download(opts, (id) => {
      const err = chrome.runtime.lastError;
      sendResponse(err ? { ok: false, error: err.message } : { ok: true, id });
    });
    return true;
  }

  // Sequential open (background)
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

  // Burst open: placeholders + deferred navigation (both grouped + always kept sorted)
  if (msg.type === "burstOpen") {
    const openerId = sender?.tab?.id || null;
    const winId    = sender?.tab?.windowId;
    const urls     = Array.isArray(msg.urls) ? [...new Set(msg.urls)] : [];
    const stepMs   = Math.max(200, Number(msg.stepMs || 1500));
    const hardCap  = Math.min(250, urls.length);
    if (hardCap === 0) {
      sendResponse({ ok: false, error: "Nothing to open." });
      return true;
    }

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

          // Keep it resident so the alarm fires reliably
          try { await chrome.tabs.update(tab.id, { autoDiscardable: false }); } catch {}

          // Create the alarm that will flip the placeholder into the real target
          const alarmName = `burst:${tab.id}`;
          chrome.alarms.create(alarmName, { when: Date.now() + delay });
          await addMapping(tab.id, targetUrl, alarmName, openerId || undefined);
          pendingSet.add(tab.id);

          // Group the placeholder immediately under the targetUrl key
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
});
