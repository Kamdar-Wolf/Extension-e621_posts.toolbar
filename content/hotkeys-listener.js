// Posluchač kláves na stránkách – čte mapu z self.HOTKEYS (viz common/hotkeys.config.js)
(function () {
  'use strict';

  const MAP = (typeof self !== "undefined" && self.HOTKEYS) ? self.HOTKEYS : {};
  if (!MAP || typeof MAP !== "object") {
    console.warn("[hotkeys] HOTKEYS config not found");
    return;
  }

  // Normalizace definice "Ctrl+Shift+Y" -> {ctrl:true, alt:false, shift:true, meta:false, key:"y"}
  function parseCombo(str) {
    const parts = String(str).split("+").map(s => s.trim()).filter(Boolean);
    const mod = { ctrl:false, alt:false, shift:false, meta:false, key:null };
    for (const p of parts) {
      const up = p.toLowerCase();
      if (up === "ctrl")  mod.ctrl = true;
      else if (up === "alt")   mod.alt = true;
      else if (up === "shift") mod.shift = true;
      else if (up === "meta")  mod.meta = true;
      else {
        // zbytek bereme jako fyzickou klávesu
        mod.key = p.length === 1 ? p.toLowerCase() : p.toLowerCase();
      }
    }
    return mod;
  }

  // Připravíme si tabulku akcí -> parsed comb
  const BINDINGS = Object.entries(MAP).map(([action, combo]) => ({
    action,
    want: parseCombo(combo)
  }));

  function inEditable(el) {
    if (!el) return false;
    if (el.isContentEditable) return true;
    const t = el.tagName ? el.tagName.toLowerCase() : "";
    return t === "input" || t === "textarea" || t === "select";
  }

  function eventMatches(e, want) {
    // modifikátory
    if (!!e.ctrlKey  !== !!want.ctrl)  return false;
    if (!!e.altKey   !== !!want.alt)   return false;
    if (!!e.shiftKey !== !!want.shift) return false;
    if (!!e.metaKey  !== !!want.meta)  return false;

    // klávesa
    let k = e.key;
    if (!k) return false;
    // normalizace: znaky -> lower, speciály necháváme
    // Porovnáváme na drobné výjimky:
    const low = k.length === 1 ? k.toLowerCase() : k.toLowerCase();

    // Mapování pár častých názvů vs. znaků
    const alts = new Set();
    if (low === "\\") alts.add("\\");
    if (low === "backslash") alts.add("\\");
    if (low === "slash") alts.add("/");
    if (low === "add") alts.add("+");  // některé numpady
    if (low === "subtract") alts.add("-");
    if (low === "equals") alts.add("=");
    if (low === "minus") alts.add("-");
    if (low === "plus") alts.add("="); // SHIFT+= je plus

    // zkráceně: match pokud přesně, nebo je v alternativách
    return (low === want.key) || (want.key && alts.has(want.key));
  }

  window.addEventListener("keydown", (e) => {
    if (inEditable(e.target)) return;

    for (const b of BINDINGS) {
      if (!b.want.key) continue;
      if (eventMatches(e, b.want)) {
        // Volitelně potlač default
        // e.preventDefault(); e.stopPropagation();
        try {
          chrome.runtime.sendMessage({ type: "hotkey-run", action: b.action });
        } catch (_) {}
        break;
      }
    }
  }, true);

  try { console.debug("[hotkeys] ready on", location.href, MAP); } catch(_) {}
})();
