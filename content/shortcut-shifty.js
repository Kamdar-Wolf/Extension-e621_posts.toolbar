// Zachytí čisté Shift+Y na stránce a pošle požadavek do backgroundu.
// Ignoruje psaní do inputů/textarea a contentEditable.

(function () {
  'use strict';

  function inEditable(el) {
    if (!el) return false;
    if (el.isContentEditable) return true;
    const tag = el.tagName ? el.tagName.toLowerCase() : "";
    return tag === "input" || tag === "textarea" || tag === "select";
  }

  window.addEventListener("keydown", (e) => {
    // čisté Shift+Y (bez Ctrl/Alt/Meta)
    //if (e.key?.toLowerCase() === "y" && e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
    if (e.key?.toLowerCase() === "\\" ) {

      if (inEditable(e.target)) return; // nepřekážet při psaní
      try {
        chrome.runtime.sendMessage({ type: "toggle-group-from-page" });
        // volitelně: e.preventDefault(); e.stopPropagation();
      } catch (_) { /* ignoruj */ }
    }
  }, true);
})();
