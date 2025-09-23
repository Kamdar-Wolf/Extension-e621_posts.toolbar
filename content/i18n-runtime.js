// content/i18n-runtime.js
(() => {
  // ====== Podporované texty UI (doplníš si svoje klíče) ======
  const DICT = {
    en: {
      openSelected: "Open selected",
      openAll: "Open all",
      cancel: "Cancel",
      downloading: "Downloading…",
      sortAsc: "Sort A → Z (1→9)",
      sortDesc: "Sort Z → A (9→1)",
      // ... přidej další klíče UI
    },
    cs: {
      openSelected: "Otevřít označené",
      openAll: "Otevřít vše",
      cancel: "Zrušit",
      downloading: "Stahuji…",
      sortAsc: "Řadit A → Z (1→9)",
      sortDesc: "Řadit Z → A (9→1)",
      // ... přidej další klíče UI
    }
    // >>> Až přidáš další jazyk (např. es), vlož sem nový blok:
    // es: { openSelected: "Abrir seleccionados", ... }
  };

  let __uiLocale = "en";

  function t(key) {
    const d = DICT[__uiLocale] || DICT.en;
    return (d && d[key]) || (DICT.en && DICT.en[key]) || key;
  }

  // Přelož všechny prvky s data-i18n
  function applyI18n(root = document) {
    const nodes = root.querySelectorAll("[data-i18n]");
    nodes.forEach(el => {
      const key = el.getAttribute("data-i18n");
      const which = el.getAttribute("data-i18n-attr"); // např. "title" / "placeholder"
      const val = t(key);
      if (!which || which === "text") {
        el.textContent = val;
      } else {
        try { el.setAttribute(which, val); } catch {}
      }
    });
    try { document.documentElement.lang = (__uiLocale === "cs" ? "cs" : __uiLocale); } catch {}
  }

  function setLocale(loc) {
    __uiLocale = (DICT[loc] ? loc : "en");
    applyI18n();
  }

  // Exponuj pro ostatní skripty
  window.kdI18n = {
    t,
    setLocale,
    applyI18n,
    get locale() { return __uiLocale; },
    addDict(locale, entries) { DICT[locale] = { ...(DICT[locale]||{}), ...(entries||{}) }; }
  };

  // Poslech na změnu jazyka z backgroundu
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === "uiLocaleChanged") {
      setLocale(msg.locale);
    }
  });

  // Po startu si vyžádej aktuální locale
  chrome.runtime.sendMessage({ type: "getUiLocale" }, (res) => {
    const loc = (res?.ok && res.locale) ? res.locale : "en";
    setLocale(loc);
  });

  // Bezpečnost: první aplikace po krátké prodlevě, kdyby DOM ještě nedorostl
  setTimeout(() => applyI18n(), 0);
})();
