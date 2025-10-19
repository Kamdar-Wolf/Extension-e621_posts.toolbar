// content/sfw-link-rewriter.js
// Přidá ?sfw=1 ke všem odkazům na e6*.net (včetně dynamiky). Běží už na document_start.

(() => {
  const SFW_QUERY_KEY = "sfw";
  const SFW_QUERY_VALUE = "1";
  const isE6Host = (host) => /^e6[\w-]*\.net$/i.test(host || "");

  const tagLink = (a) => {
    try {
      const href = a.getAttribute("href");
      if (!href) return;
      const u = new URL(href, location.href);
      if (!isE6Host(u.hostname)) return;

      if (u.searchParams.get(SFW_QUERY_KEY) !== SFW_QUERY_VALUE) {
        u.searchParams.set(SFW_QUERY_KEY, SFW_QUERY_VALUE);
        // zachovat relativitu, pokud byla
        if (/^https?:\/\//i.test(href)) {
          a.setAttribute("href", u.toString());
        } else {
          a.setAttribute("href", u.pathname + u.search + u.hash);
        }
      }
    } catch {}
  };

  const processAll = (root = document) => {
    try {
      root.querySelectorAll?.("a[href]")?.forEach(tagLink);
    } catch {}
  };

  // 1) co nejdříve zkuste přepsat už existující odkazy
  if (document.documentElement) processAll(document);

  // 2) dynamické změny (SPA, infinite scroll, AJAX)
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

  try {
    mo.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["href"]
    });
  } catch {}

  // 3) některé stránky mění URL přes History API bez reloadu — přepiš odkazy i po změně
  const patchHistory = (method) => {
    const orig = history[method];
    history[method] = function(...args) {
      const ret = orig.apply(this, args);
      try { processAll(document); } catch {}
      return ret;
    };
  };
  try { patchHistory("pushState"); patchHistory("replaceState"); } catch {}

  // 4) jako pojistka i po popstate
  window.addEventListener?.("popstate", () => { try { processAll(document); } catch {} });

  // 5) bonus: localStorage přepínač, kdyby ho web respektoval
  try { localStorage.setItem(SFW_QUERY_KEY, SFW_QUERY_VALUE); } catch {}
})();
