/* =========================
   e6-post-toolbar.js
   ========================= */

(function(){
  'use strict';
  // --- Spodní plovoucí toolbar (původní funkce, zachováno) ---
  const toolbar = document.querySelector('#ptbr-wrapper');
  const imgWrap = document.querySelector('#image-container');
  const image   = document.querySelector('#image') || imgWrap?.querySelector('img,video,canvas');
  const content = document.querySelector('div.content') || document.body;
  if (!toolbar || !imgWrap || !image) return;

  const host = document.querySelector('#image-and-nav') || document.body;
  host.appendChild(toolbar);

  let shell = document.querySelector('#kd-ptbr-shell');
  if (!shell) {
    shell = document.createElement('div');
    shell.id = 'kd-ptbr-shell';
    document.body.appendChild(shell);
  }
  Object.assign(shell.style, { position:'fixed', bottom:'8px', zIndex:99998, pointerEvents:'none' });

  let inner = toolbar.querySelector('.kd-ptbr-inner');
  if (!inner) {
    inner = document.createElement('div');
    inner.className = 'kd-ptbr-inner';
    while (toolbar.firstChild) inner.appendChild(toolbar.firstChild);
    toolbar.appendChild(inner);
  }
  Object.assign(toolbar.style, {position:'static', background:'transparent', padding:'0', margin:'0', boxShadow:'none'});
  Object.assign(inner.style, {
    display:'inline-flex', alignItems:'center', gap:'8px',
    padding:'8px 10px', borderRadius:'10px',
    maxWidth:'min(1100px, 96vw)', pointerEvents:'auto'
  });

  if (!shell.contains(toolbar)) shell.appendChild(toolbar);

  function positionShell(){
    const r = content.getBoundingClientRect();
    const toolbarW = toolbar.offsetWidth || inner.offsetWidth || 600;
    const centerX = r.left + (r.width/2);
    shell.style.left = Math.round(centerX - toolbarW/2) + 'px';
    const minLeft=8, maxLeft=document.documentElement.clientWidth - toolbarW - 8;
    const curLeft=parseFloat(shell.style.left);
    shell.style.left = Math.max(minLeft, Math.min(maxLeft, curLeft)) + 'px';
  }

  const style = document.createElement('style');
  style.textContent = `
    :root { --kd-ptbr-h: 56px; }
    #image-container { display:flex; justify-content:center; align-items:flex-start; margin:0 auto; max-width:100vw; }
    #image, #image-container img, #image-container video, #image-container canvas {
      height:auto !important; width:auto; max-width:min(100%, calc(100vw - 16px));
      max-height: calc(95vh - var(--kd-ptbr-h) - 35px) !important; object-fit: contain; display:block;
    }
    body { padding-bottom: calc(var(--kd-ptbr-h) + 12px); }
  `;
  document.head.appendChild(style);

  const sel = document.querySelector('#image-resize-selector');
  if (sel && sel.value !== 'fitv') {
    sel.value = 'fitv';
    sel.dispatchEvent(new Event('change', {bubbles:true}));
  }

  function apply(){
    const h = Math.ceil(toolbar.getBoundingClientRect().height || inner.getBoundingClientRect().height || 56);
    document.documentElement.style.setProperty('--kd-ptbr-h', h + 'px');
    positionShell();
  }
  apply();

  new ResizeObserver(apply).observe(inner);
  new ResizeObserver(apply).observe(content);
  addEventListener('resize', apply);

  new MutationObserver(() => {
    image.style.maxHeight = `calc(95vh - var(--kd-ptbr-h))`;
    image.style.height = 'auto';
  }).observe(image, { attributes:true, attributeFilter:['style','class'] });
})();

/* ====== NAV + SEARCH: nav fixní nahoře; search zůstává v DOM na místě (jen se smrští)
         Handle vpravo nahoře (chevron), zkratka Shift+|, DRAGGABLE po OKRAJÍCH s pamětí pozice ====== */
(() => {
  'use strict';

  const nav    = document.querySelector('nav.navigation');
  const search = document.querySelector('div.search');
  if (!nav && !search) return;

  // --- Stylování (CSS) ---
  const style = document.createElement('style');
  style.textContent = `
    :root { --kd-nav-h: 0px; }

    /* NAV – fixně nahoře, aby se dal odjet mimo viewport */
    nav.navigation.kd-fixed {
      position: fixed !important;
      top: 0; left: 0; right: 0;
      z-index: 99990;
      transform: translateY(0);
      transition: transform 180ms ease;
    }
    nav.navigation.kd-fixed.kd-collapsed {
      transform: translateY(-100%);
      box-shadow: none !important;
    }

    /* Tělo stránky – padding-top pouze o výšku NAV (SEARCH je ve flow) */
    body.kd-nav-expanded  { padding-top: var(--kd-nav-h) !important; }
    body.kd-nav-collapsed { padding-top: 0 !important; }

    /* SEARCH – ve flow; při sbalení se bezezbytku “zcvrkne” */
    div.search.kd-collapsed {
      height: 0 !important;
      margin: 0 !important;
      padding: 0 !important;
      border: 0 !important;
      overflow: hidden !important;
      visibility: hidden !important;
      pointer-events: none !important;
      display: block !important; /* jistota proti grid/flex/sticky layoutům */
    }

    /* Handle – nenápadný chevron, DRAGGABLE po okrajích */
    #kd-nav-handle {
      position: fixed;
      top: 10px; right: 10px; left: auto; /* výchozí pozice vpravo nahoře */
      width: 28px; height: 28px;
      display: inline-flex; align-items: center; justify-content: center;
      color: var(--kd-handle-fg, currentColor);
      background: var(--kd-handle-bg, transparent);
      border: none; border-radius: 999px;
      cursor: grab;
      padding: 0; line-height: 1;
      box-shadow: none; backdrop-filter: blur(2px);
      z-index: 99995; user-select: none;
      opacity: .35;
      transition: opacity 160ms ease, background-color 160ms ease, transform 160ms ease;
      touch-action: none; /* plynulé dragování na touch */
    }
    #kd-nav-handle:hover, #kd-nav-handle:focus-visible { opacity: .9; }
    #kd-nav-handle:focus-visible {
      outline: 2px solid color-mix(in srgb, currentColor 40%, transparent);
      outline-offset: 2px;
    }
    #kd-nav-handle.kd-dragging { cursor: grabbing; opacity: .95; transition: none; }

    /* SVG dědí barvu z currentColor */
    #kd-nav-handle svg {
      width: 20px; height: 20px; stroke: currentColor;
      transition: transform 160ms ease;
      pointer-events: none; /* ať chytáme celý button, ne path */
    }

    /* Rotace šipky: rozbaleno = nahoru (180°), sbaleno = dolů (0°) */
    body.kd-nav-expanded  #kd-nav-handle svg { transform: rotate(180deg); }
    body.kd-nav-collapsed #kd-nav-handle svg { transform: rotate(0deg); }

    @media (prefers-color-scheme: dark) { #kd-nav-handle { opacity: .45; } }
  `;
  document.head.appendChild(style);

  // --- Handle tlačítko (mimo nav/search, aby nezmizelo) ---
  const handle = document.createElement('button');
  handle.id = 'kd-nav-handle';
  handle.type = 'button';
  handle.setAttribute('aria-label', 'Sbalit/rozbalit horní panel');
  handle.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"
         viewBox="0 0 24 24" fill="none" stroke="currentColor"
         stroke-width="2" stroke-linecap="round" stroke-linejoin="round" name="chevron_down">
      <path d="m6 9 6 6 6-6"></path>
    </svg>
  `;
  document.body.appendChild(handle);

  // --- Barvy tlačítka z <nav> ---
  function kdInitHandleTheme(navEl, handleEl) {
    const src = navEl || document.body;
    const cs = getComputedStyle(src);
    const navBg = cs.backgroundColor || 'rgba(255,255,255,1)';
    const navFg = cs.color || 'rgb(0,0,0)';

    function parseRGBA(str) {
      const m = str.match(/rgba?\s*\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)/i);
      if (!m) return { r:255, g:255, b:255, a:1 };
      return { r:+m[1], g:+m[2], b:+m[3], a: m[4] !== undefined ? +m[4] : 1 };
    }
    const bg = parseRGBA(navBg);
    const bgIdle  = `rgba(${bg.r}, ${bg.g}, ${bg.b}, 0.08)`;
    const bgHover = `rgba(${bg.r}, ${bg.g}, ${bg.b}, 0.16)`;

    handleEl.style.setProperty('--kd-handle-fg', navFg);
    handleEl.style.setProperty('--kd-handle-bg', bgIdle);

    handleEl.addEventListener('mouseenter', () => handleEl.style.setProperty('--kd-handle-bg', bgHover));
    handleEl.addEventListener('mouseleave', () => handleEl.style.setProperty('--kd-handle-bg', bgIdle));
  }
  kdInitHandleTheme(nav, handle);

  // --- Měření výšky NAV (SEARCH už neměříme – je ve flow) ---
  function measureAndSetNavHeight(){
    if (!nav) return;
    const wasCollapsed = nav.classList.contains('kd-collapsed');
    nav.classList.add('kd-fixed');
    nav.classList.remove('kd-collapsed'); // dočasně ukázat pro měření
    const h = Math.ceil(nav.getBoundingClientRect().height || 0);
    document.documentElement.style.setProperty('--kd-nav-h', `${h}px`);
    if (wasCollapsed) nav.classList.add('kd-collapsed');
  }

  // --- Přepínač stavu (nav fixed + search shrink) ---
  const KEY = 'kd.nav.collapsed.v6';
  function setCollapsed(on){
    if (on) {
      if (nav)    nav.classList.add('kd-fixed','kd-collapsed');
      if (search) search.classList.add('kd-collapsed'); // jen shrink, zůstává ve flow
      document.body.classList.remove('kd-nav-expanded');
      document.body.classList.add('kd-nav-collapsed');
    } else {
      measureAndSetNavHeight();
      if (nav)    { nav.classList.add('kd-fixed');    nav.classList.remove('kd-collapsed'); }
      if (search) { search.classList.remove('kd-collapsed'); } // vrátí původní výšku na místě
      document.body.classList.remove('kd-nav-collapsed');
      document.body.classList.add('kd-nav-expanded');
    }
    try { localStorage.setItem(KEY, JSON.stringify(!!on)); } catch {}
  }

  // --- Klik na handle (funguje i po drag&drop – práh níže) ---
  function toggleByClick(){
    const isCollapsed = !!(nav && nav.classList.contains('kd-collapsed'));
    setCollapsed(!isCollapsed);
  }

  // --- Klávesová zkratka Shift + | (Backslash + Shift na různých layoutech) ---
  addEventListener('keydown', (e) => {
    const t = e.target;
    const isFormField = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
    if (isFormField) return;

    const isShiftPipe = e.shiftKey && (e.key === '|' || e.code === 'Backslash');
    if (!isShiftPipe) return;

    e.preventDefault();
    const isCollapsed = !!(nav && nav.classList.contains('kd-collapsed'));
    setCollapsed(!isCollapsed);
  });

  // --- Reflow při změně velikosti/dynamických změnách NAV ---
  const ro = new ResizeObserver(() => {
    const expanded = document.body.classList.contains('kd-nav-expanded');
    if (expanded) measureAndSetNavHeight();
    if (typeof window.clampHandleIntoViewport === 'function') window.clampHandleIntoViewport();
  });
  if (nav) { try { ro.observe(nav); } catch {} }

  addEventListener('resize', () => {
    const expanded = document.body.classList.contains('kd-nav-expanded');
    if (expanded) measureAndSetNavHeight();
    if (typeof window.clampHandleIntoViewport === 'function') window.clampHandleIntoViewport();
  }, { passive: true });

  // --- Inicializace nav/search ---
  if (nav) { nav.classList.add('kd-fixed'); measureAndSetNavHeight(); }
  const collapsedInit = (() => {
    try { return JSON.parse(localStorage.getItem(KEY) || 'false'); }
    catch { return false; }
  })();
  setCollapsed(!!collapsedInit);

  /* === DRAG & DROP po OKRAJÍCH (snap na hranu, s pamětí pozice) === */
  (function initEdgeDraggableHandle(){
    const POS_KEY = 'kd.nav.handle.pos.edge.v1';

    // Pomocné
    function bounds() {
      const w = document.documentElement.clientWidth;
      const h = document.documentElement.clientHeight;
      const r = handle.getBoundingClientRect();
      const m = 4; // minimální mezera od okrajů
      return {
        minX: m,
        minY: m,
        maxX: w - r.width - m,
        maxY: h - r.height - m,
        w, h, r, m
      };
    }
    function clamp(v, min, max){ return Math.max(min, Math.min(max, v)); }

    // Projekce kurzoru na nejbližší hranu viewportu → souřadnice handle
    function projectToEdge(clientX, clientY) {
      const b = bounds();
      const rW = b.r.width;
      const rH = b.r.height;

      // Vzdálenosti kurzoru od 4 hran (k linii okraje)
      const dL = Math.abs(clientX - b.minX);
      const dR = Math.abs(clientX - (b.maxX + rW));
      const dT = Math.abs(clientY - b.minY);
      const dB = Math.abs(clientY - (b.maxY + rH));

      // Nejbližší hrana
      let edge = 'left';
      let best = dL;
      if (dR < best) { best = dR; edge = 'right'; }
      if (dT < best) { best = dT; edge = 'top'; }
      if (dB < best) { best = dB; edge = 'bottom'; }

      // Projekce na danou hranu (handle centrovaně „lepí“ pod kurzor)
      let left = b.r.left;
      let top  = b.r.top;

      if (edge === 'left') {
        left = b.minX;
        top  = clamp(clientY - rH/2, b.minY, b.maxY);
      } else if (edge === 'right') {
        left = b.maxX;
        top  = clamp(clientY - rH/2, b.minY, b.maxY);
      } else if (edge === 'top') {
        top  = b.minY;
        left = clamp(clientX - rW/2, b.minX, b.maxX);
      } else { // bottom
        top  = b.maxY;
        left = clamp(clientX - rW/2, b.minX, b.maxX);
      }

      return { left, top, edge };
    }

    // Přicvaknutí do viewportu (při resize) — zachová současnou hranu
    function clampToCurrentEdge() {
      const b = bounds();
      let left = b.r.left, top = b.r.top;

      // Zjisti, ke které hraně je přichyceno (tolerance 8 px)
      const tol = 8;
      let edge = 'left';
      if (Math.abs(b.r.left - b.minX) <= tol) edge = 'left';
      else if (Math.abs(b.r.left - b.maxX) <= tol) edge = 'right';
      else if (Math.abs(b.r.top  - b.minY) <= tol) edge = 'top';
      else if (Math.abs(b.r.top  - b.maxY) <= tol) edge = 'bottom';

      if (edge === 'left') {
        left = b.minX;
        top  = clamp(b.r.top, b.minY, b.maxY);
      } else if (edge === 'right') {
        left = b.maxX;
        top  = clamp(b.r.top, b.minY, b.maxY);
      } else if (edge === 'top') {
        top  = b.minY;
        left = clamp(b.r.left, b.minX, b.maxX);
      } else { // bottom
        top  = b.maxY;
        left = clamp(b.r.left, b.minX, b.maxX);
      }

      handle.style.left = Math.round(left) + 'px';
      handle.style.top  = Math.round(top)  + 'px';
      handle.style.right = 'auto';
    }
    window.clampHandleIntoViewport = clampToCurrentEdge;

    // Ulož/obnov pozici
    function savePos(){
      const r = handle.getBoundingClientRect();
      try { localStorage.setItem(POS_KEY, JSON.stringify({ x: Math.round(r.left), y: Math.round(r.top) })); } catch {}
    }
    function restorePos(){
      try {
        const saved = JSON.parse(localStorage.getItem(POS_KEY) || 'null');
        if (saved && typeof saved.x === 'number' && typeof saved.y === 'number') {
          handle.style.left = saved.x + 'px';
          handle.style.top  = saved.y + 'px';
          handle.style.right = 'auto';
          clampToCurrentEdge();
        }
      } catch {}
    }

    // Stav dragování
    let dragging = false;
    let movedPx = 0;
    const CLICK_THRESHOLD = 6; // pod tím bereme jako klik (toggle)

    function pointerDown(e){
      if (e.pointerType === 'mouse' && e.button !== 0) return;

      // Převeď na left/top (kdyby byla výchozí pozice přes right)
      const r = handle.getBoundingClientRect();
      handle.style.left = r.left + 'px';
      handle.style.top  = r.top  + 'px';
      handle.style.right = 'auto';

      dragging = true;
      movedPx = 0;
      handle.classList.add('kd-dragging');
      try { handle.setPointerCapture(e.pointerId); } catch {}
      e.preventDefault();
    }

    function pointerMove(e){
      if (!dragging) return;
      // Projekce kurzoru na nejbližší hranu
      const p = projectToEdge(e.clientX, e.clientY);
      const r = handle.getBoundingClientRect();
      movedPx = Math.max(movedPx, Math.hypot(p.left - r.left, p.top - r.top));

      handle.style.left = Math.round(p.left) + 'px';
      handle.style.top  = Math.round(p.top)  + 'px';
      handle.style.right = 'auto';
    }

    function pointerUp(e){
      if (!dragging) return;
      dragging = false;
      handle.classList.remove('kd-dragging');
      try { handle.releasePointerCapture(e.pointerId); } catch {}

      clampToCurrentEdge();
      savePos();

      if (movedPx <= CLICK_THRESHOLD) {
        toggleByClick();
      }
    }

    // Listeners
    handle.addEventListener('pointerdown', pointerDown);
    window.addEventListener('pointermove', pointerMove);
    window.addEventListener('pointerup', pointerUp);
    window.addEventListener('pointercancel', pointerUp);

    // Inicializace pozice
    restorePos();
    clampToCurrentEdge();
  })();
})();
