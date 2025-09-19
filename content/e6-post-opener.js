(() => {
  'use strict';

  // ===== GM shim (storage + downloads + tabs) =====
  const __cache = Object.create(null);
  let __ready = false, __wait = [];
  chrome.storage.local.get(null, items => { Object.assign(__cache, items||{}); __ready=true; __wait.splice(0).forEach(fn=>{try{fn();}catch{}}); });
  const __onReady = fn => (__ready ? fn() : __wait.push(fn));

  function GM_getValue(k, d=null){ return (k in __cache) ? __cache[k] : d; }
  function GM_setValue(k, v){ __cache[k]=v; try{ chrome.storage.local.set({[k]:v}); }catch{} }
  function GM_addValueChangeListener(k, cb){
    try{ chrome.storage.onChanged.addListener((ch, area)=>{ if(area!=='local'||!ch[k])return;
      const {oldValue,newValue}=ch[k]; __cache[k]=newValue; try{ cb(k, oldValue, newValue); } catch{} }); }catch{}
  }
  function GM_openInTab(url, opts){
    try{
      chrome.runtime.sendMessage({type:'openInBackground', url}, (res)=>{ /* ignore */ });
    }catch{}
    try{ window.open(url, '_blank', 'noopener'); }catch{}
  }

  // ===== Helpers =====
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const byId = (id) => document.getElementById(id);
  const fmtSec = s => (s<60?`${s|0}s`:`${(s/60)|0}m ${(s%60)|0}s`);

  // ===== Konstanty a texty =====
  const HARD_CAP = 250;
  const UI_WIDTH = '215px';
  const HIDDEN_CLASS = 'kd-hidden';

  const TXT = {
    cs: {
      langToggle: 'Přepnout jazyk',
      titleOpen: 'Otevřít',
      titleDownload: 'Stáhnout',
      gear: 'Sbalit/rozbalit nastavení',
      gearExpand: 'Rozbalit nastavení',
      gearCollapse: 'Sbalit nastavení',
      minimize: 'Minimalizovat',
      close: 'Zavřít',
      sfw: 'Přepnout SFW (\\)',
      viewOpen: 'Přepnout na Stahování',
      viewDownload: 'Přepnout na Otevírání',
      modeLabel: 'Režim',
      modePost: 'post (stránka příspěvku)',
      modeFile: 'file (plný soubor)',
      delayLabelOpen: 'Prodleva mezi otvíráním (ms)',
      delayLabelDownload: 'Prodleva mezi stahováním (ms)',
      limitLabelOpen:  `Počet k otevření (max ${HARD_CAP})`,
      limitLabelDownload: `Počet stažení (max ${HARD_CAP})`,
      destLabel: 'Cílová složka',
      chooseFolder: 'ZVOLIT SLOŽKU',
      folderDefault: 'Stažené soubory (výchozí)',
      folderChosen: (name) => `Složka: ${name}`,
      startOpen: 'Start',
      startDownload: 'Stáhnout',
      pause: 'Pozastavit',
      resume: 'Pokračovat',
      stop: 'Stop',
      ready: 'Připraveno.',
      running: 'Běží…',
      paused: 'Pozastaveno',
      done: 'Hotovo ✔',
      nothing: 'Nic k otevření',
      noGallery: 'Na této stránce není galerie / grid.',
      eta: 'ETA',
      fsCancel: 'Výběr složky zrušen nebo selhal. Použiji výchozí „Stažené soubory“.'
    },
    en: {
      langToggle: 'Toggle language',
      titleOpen: 'Open',
      titleDownload: 'Download',
      gear: 'Collapse/expand settings',
      gearExpand: 'Expand settings',
      gearCollapse: 'Collapse settings',
      minimize: 'Minimize',
      close: 'Close',
      sfw: 'Toggle SFW (\\)',
      viewOpen: 'Switch to Download',
      viewDownload: 'Switch to Open',
      modeLabel: 'Mode',
      modePost: 'post (post page)',
      modeFile: 'file (full file)',
      delayLabelOpen: 'Delay between opens (ms)',
      delayLabelDownload: 'Delay between downloads (ms)',
      limitLabelOpen:  `Number to open (max ${HARD_CAP})`,
      limitLabelDownload: `Number to download (max ${HARD_CAP})`,
      destLabel: 'Destination',
      chooseFolder: 'CHOOSE FOLDER',
      folderDefault: 'Downloads (default)',
      folderChosen: (name) => `Folder: ${name}`,
      startOpen: 'Start',
      startDownload: 'Download',
      pause: 'Pause',
      resume: 'Resume',
      stop: 'Stop',
      ready: 'Ready.',
      running: 'Running…',
      paused: 'Paused',
      done: 'Done ✔',
      nothing: 'Nothing to open',
      noGallery: 'No grid/gallery on this page.',
      eta: 'ETA',
      fsCancel: 'Folder selection cancelled or failed. Falling back to Downloads.'
    }
  };

  // ===== Stav (sdílený přes storage) =====
  const STATE_KEY = 'kd_shared_state';
  const LANG_KEY  = 'kd_lang';
  const GM_Get    = GM_getValue;
  const GM_Set    = GM_setValue;

  __onReady(async () => {
    let lang = (GM_Get(LANG_KEY) || 'cs');
    if (lang !== 'cs' && lang !== 'en') lang = 'cs';

    const t = (k, ...a) => {
      const v = TXT[lang][k];
      return (typeof v === 'function') ? v(...a) : v;
    };

    // ---------- SFW ----------
    const isGallery = /^\/posts(\?|$)/.test(location.pathname + location.search);
    const SFW_KEY = isGallery ? 'kd_sfw_mode_gallery' : 'kd_sfw_mode_post';
    const sfwEnabled = () => localStorage.getItem(SFW_KEY) === '1';
    function setSfw(on){
      if (on) localStorage.setItem(SFW_KEY,'1'); else localStorage.removeItem(SFW_KEY);
      document.documentElement.classList.toggle('kd-sfw', on);
    }
    const style = document.createElement('style');
    style.textContent = `
      .kd-sfw img, .kd-sfw picture, .kd-sfw video, .kd-sfw source { opacity:0 !important; visibility:hidden !important; }
      .kd-sfw article.thumbnail { background:#0c0c0c !important; border-radius:8px; }
      .kd-sfw #image-container, .kd-sfw #image { background:#0c0c0c !important; }
      .${HIDDEN_CLASS} { display: none !important; }
    `;
    document.head.appendChild(style);
    setSfw(sfwEnabled());

    // Keyboard shortcut for SFW: "\" key (works on CZ layout with AltGr)
    if (!window.__kd_sfwHotkeyBound) {
      window.__kd_sfwHotkeyBound = true;
      document.addEventListener('keydown', (e) => {
        const tag = (e.target?.tagName || '').toLowerCase();
        const inEditable = e.target?.isContentEditable;
        if (tag === 'input' || tag === 'textarea' || tag === 'select' || inEditable) return;
        if (e.key === '\\' || (!e.ctrlKey && !e.altKey && !e.metaKey && e.code === 'Backslash')) {
          e.preventDefault();
          try { setSfw(!sfwEnabled()); } catch {}
        }
      }, true);
    }

    // ---------- UI ----------
    const box = document.createElement('div');
    Object.assign(box.style, {
      position:'static',
      width: UI_WIDTH,
      margin:'8px 0',
      background: 'transparent',
      color: 'inherit',
      fontFamily: 'Verdana, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif',
      fontSize: '12px',
      lineHeight: '1.35',
      pointerEvents: 'auto'
    });
    box.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;gap:6px;">
        <div style="display:flex;align-items:center;gap:6px;min-width:0;">
          <button id="e6-lang" type="button" title="${t('langToggle')}"
                  style="all:unset;cursor:pointer;font-size:16px;line-height:1;display:flex;align-items:center">${lang==='cs'?'🇨🇿':'🇬🇧'}</button>
          <strong id="e6-title" style="font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${(GM_Get('kd_view_mode')||'open')==='open'?t('titleOpen'):t('titleDownload')}</strong>
        </div>
        <div style="display:flex;gap:6px;align-items:center;flex-shrink:0;">
          <button id="e6-sfw"   type="button" title="${t('sfw')}" style="all:unset;cursor:pointer;opacity:.9;">🛡️</button>
          <button id="e6-view"  type="button" title="${(GM_Get('kd_view_mode')||'open')==='open'?t('viewOpen'):t('viewDownload')}" style="all:unset;cursor:pointer;opacity:.9;">${(GM_Get('kd_view_mode')||'open')==='open'?'⬇️':'🔗'}</button>
          <button id="e6-cset"  type="button" title="${t('gear')}" style="all:unset;cursor:pointer;opacity:.85;">⚙️</button>
          <button id="e6-min"   type="button" title="${t('minimize')}" style="all:unset;cursor:pointer;opacity:.85;">▁</button>
          <button id="e6-close" type="button" title="${t('close')}" style="all:unset;cursor:pointer;opacity:.85;">✕</button>
        </div>
      </div>

      <div id="e6-body">
        <div id="e6-settings" class="${HIDDEN_CLASS}" style="flex-direction:column;gap:8px;margin-bottom:6px;">
          <div id="grp-mode">
            <div id="lbl-mode" style="margin-bottom:2px;">${t('modeLabel')}</div>
            <select id="e6-mode" style="width:100%;padding:5px;border-radius:6px;background:#111;border:none;color:inherit;">
              <option value="post" selected>${t('modePost')}</option>
              <option value="file">${t('modeFile')}</option>
            </select>
          </div>
          <div id="grp-delay">
            <div id="lbl-delay" style="margin-bottom:2px;"></div>
            <input id="e6-delay" type="number" min="200" step="100" value="1500"
                   style="width:100%;padding:5px;border-radius:6px;background:#111;border:none;color:inherit;">
          </div>
          <div id="grp-limit">
            <div id="lbl-limit" style="margin-bottom:2px;"></div>
            <input id="e6-limit" type="number" min="1" max="${HARD_CAP}" step="1" value="${HARD_CAP}"
                   style="width:100%;padding:5px;border-radius:6px;background:#111;border:none;color:inherit;">
          </div>
          <div id="grp-dest" style="display:none;">
            <div id="lbl-dest" style="margin-bottom:2px;">${t('destLabel')}</div>
            <div style="display:flex;gap:6px;align-items:center;">
              <button id="e6-choose-dir" type="button" style="padding:6px 8px;border-radius:8px;background:#ffee95;border:none;color:#9da6ad;cursor:pointer;">${t('chooseFolder')}</button>
              <div id="e6-dir-label" style="opacity:.95;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1 1 auto;">${t('folderDefault')}</div>
            </div>
          </div>
        </div>

        <div style="margin:6px 0 4px;">
          <div id="e6-bar" style="height:6px;background:#0a0;border-radius:6px;overflow:hidden;">
            <div id="e6-fill" style="height:100%;width:0%;background:#39ff39;"></div>
          </div>
        </div>

        <div id="e6-stats" style="margin:2px 0 4px;opacity:.95;">${t('ready')}</div>
        <div id="e6-stats2" style="margin:0 0 6px;opacity:.85;"></div>

        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          <button id="e6-toggle" type="button"
                  style="flex:1;padding:6px 8px;border-radius:8px;background:#2b9bff;border:none;color:#fff;cursor:pointer;">${(GM_Get('kd_view_mode')||'open')==='open'?t('startOpen'):t('startDownload')}</button>
          <button id="e6-stop"   type="button"
                  style="flex:1;padding:6px 8px;border-radius:8px;background:#b11b1b;border:none;color:#fff;cursor:pointer;">${t('stop')}</button>
        </div>

        <div id="e6-note" style="margin-top:6px;opacity:.95;">${t('ready')}</div>
      </div>

      <div id="e6-mini" style="display:none;opacity:.95;">(min) <span id="e6-mini-text">0 | ${t('eta')} 0s</span></div>
    `;

    function findSidebar(){ return document.querySelector('.sidebar, #sidebar, aside.sidebar, #tag-sidebar, .post-sidebar'); }
    function mountInSidebar(){
      const sb = findSidebar(); if (!sb) return false;
      if (box.parentNode && box.parentNode !== sb) box.parentNode.remove();
      sb.prepend(box);
      return true;
    }
    function mountTop(){
      const host = document.querySelector('.content, #content, main') || document.body;
      if (box.parentNode && box.parentNode !== host) box.parentNode.remove();
      host.prepend(box);
    }
    if (!mountInSidebar()) mountTop();
    addEventListener('popstate', mountInSidebar);
    document.addEventListener('pjax:end', mountInSidebar);
    document.addEventListener('turbo:load', mountInSidebar);

    // ---------- Elementy ----------
    const el = {
      lang: byId('e6-lang'),
      title: byId('e6-title'),
      sfw: byId('e6-sfw'),
      view: byId('e6-view'),
      cset: byId('e6-cset'),
      min: byId('e6-min'),
      close: byId('e6-close'),
      body: byId('e6-body'),
      settings: byId('e6-settings'),
      grpMode: byId('grp-mode'),
      mode: byId('e6-mode'),
      lblMode: byId('lbl-mode'),
      grpDelay: byId('grp-delay'),
      lblDelay: byId('lbl-delay'),
      delay: byId('e6-delay'),
      grpLimit: byId('grp-limit'),
      lblLimit: byId('lbl-limit'),
      limit: byId('e6-limit'),
      grpDest: byId('grp-dest'),
      lblDest: byId('lbl-dest'),
      chooseDir: byId('e6-choose-dir'),
      dirLabel: byId('e6-dir-label'),
      bar: byId('e6-bar'),
      fill: byId('e6-fill'),
      stats: byId('e6-stats'),
      stats2: byId('e6-stats2'),
      toggle: byId('e6-toggle'),
      stop: byId('e6-stop'),
      note: byId('e6-note'),
      mini: byId('e6-mini'),
      miniTxt: byId('e6-mini-text')
    };

    // ---------- Lokální stav ----------
    let settingsCollapsed = true;
    let viewMode = GM_Get('kd_view_mode') || 'open'; // 'open' | 'download'
    let delayMs = 1500;
    let maxCount = HARD_CAP;
    let running = false;
    let paused = false;
    let timer = null;
    let urls = [];
    let idx = 0;
    let lastChosenDir = null;
    let lastChosenDirName = '';

    // ---------- Helpers UI ----------
    function titleForView(){ return viewMode==='open' ? t('titleOpen') : t('titleDownload'); }
    function hasGrid(){
      return !!document.querySelector('article.thumbnail, .thumb, .post-preview, .posts .thumbnail-container');
    }
    function swallow(e){ e?.preventDefault?.(); e?.stopPropagation?.(); }

    function setSettingsCollapsed(c){
      settingsCollapsed = !!c;
      el.settings.classList.toggle(HIDDEN_CLASS, settingsCollapsed);
      el.cset.title = settingsCollapsed ? t('gearExpand') : t('gearCollapse');
    }
    setSettingsCollapsed(true);

    function renderStats(opened,total,left,running,delay){
      el.stats.textContent = `${opened}/${total} | ${t('eta')} ${fmtSec(((left||0)*(delay||0))/1000|0)}`;
      el.stats2.textContent = (running ? t('running') : (opened===total && total>0 ? t('done') : t('ready')));
    }

    function applyLangTexts() {
      el.lang.title = t('langToggle');
      el.lang.textContent = (lang === 'cs') ? '🇨🇿' : '🇬🇧';
      el.title.textContent = titleForView();
      el.sfw.title = t('sfw');
      el.cset.title = settingsCollapsed ? t('gearExpand') : t('gearCollapse');
      el.min.title = t('minimize'); el.close.title = t('close');
      el.view.title = (viewMode==='open' ? t('viewOpen') : t('viewDownload'));
      el.lblMode.textContent = t('modeLabel');
      el.mode.querySelector('option[value="post"]').textContent = t('modePost');
      el.mode.querySelector('option[value="file"]').textContent = t('modeFile');
      el.lblDelay.textContent = (viewMode==='open' ? TXT[lang].delayLabelOpen : TXT[lang].delayLabelDownload);
      el.lblLimit.textContent = (viewMode==='open' ? TXT[lang].limitLabelOpen : TXT[lang].limitLabelDownload);
      el.lblDest.textContent = TXT[lang].destLabel;
      el.chooseDir.textContent = TXT[lang].chooseFolder;
      el.dirLabel.textContent = lastChosenDirName ? TXT[lang].folderChosen(lastChosenDirName) : TXT[lang].folderDefault;
      if (!running) {
        el.toggle.textContent = (viewMode==='open' ? TXT[lang].startOpen : TXT[lang].startDownload);
        el.note.textContent = TXT[lang].ready;
      }
    }

    // ---------- Přepínání View ----------
    function setView(nextMode){
      if (nextMode !== 'open' && nextMode !== 'download') return;
      viewMode = nextMode; GM_Set('kd_view_mode', viewMode);
      el.grpMode.style.display = (viewMode === 'download') ? 'none' : 'block';
      el.grpDest.style.display = (viewMode === 'download') ? 'block' : 'none';
      el.lblDelay.textContent = (viewMode==='open' ? TXT[lang].delayLabelOpen : TXT[lang].delayLabelDownload);
      el.lblLimit.textContent = (viewMode==='open' ? TXT[lang].limitLabelOpen : TXT[lang].limitLabelDownload);
      el.view.textContent = (viewMode==='open' ? '⬇️' : '🔗');
      el.view.title = (viewMode==='open' ? TXT[lang].viewOpen : TXT[lang].viewDownload);
      el.title.textContent = titleForView();
      if (!running) el.toggle.textContent = (viewMode==='open' ? TXT[lang].startOpen : TXT[lang].startDownload);
      if (viewMode === 'download') setSettingsCollapsed(false);
      applyLangTexts();
    }

    // ---------- Kolekce URL ----------
    function collectUrls(){
      const links = [];
      const grid = document.querySelectorAll('article.thumbnail a[href*="/posts/"], .post-preview a[href*="/posts/"]');
      grid.forEach(a => {
        try {
          const href = a.getAttribute('href') || '';
          const url = new URL(href, location.href).href;
          links.push(url);
        } catch {}
      });
      return links.slice(0, HARD_CAP);
    }

    function updateBar(){
      const total = urls.length;
      const opened = Math.min(idx, total);
      const left = Math.max(0, total - opened);
      const per = total ? Math.round((opened/total)*100) : 0;
      el.fill.style.width = per + '%';
      renderStats(opened,total,left,running,delayMs);
    }

    function stopRun(noteKey='paused'){
      running=false; paused=false; clearTimeout(timer); timer=null;
      if (activeAbort) { try { activeAbort.abort(); } catch {} activeAbort = null; }
      el.toggle.textContent=(viewMode==='open'?TXT[lang].startOpen:TXT[lang].startDownload);
      const st = GM_Get(STATE_KEY) || {};
      st.running=false; st.note = (noteKey==='paused'?TXT[lang].paused:TXT[lang].ready);
      GM_Set(STATE_KEY, st);
      el.note.textContent = st.note;
    }

    let activeAbort = null;

    async function stepOpen(){
      if (!running) return;
      if (idx >= urls.length) { stopRun('done'); updateBar(); return; }
      const u = urls[idx++];
      GM_openInTab(u, { active:false });
      updateBar();
      timer = setTimeout(stepOpen, delayMs);
    }

    async function stepDownload(){
      if (!running) return;
      if (idx >= urls.length) { stopRun('done'); updateBar(); return; }
      const u = urls[idx++];

      if (lastChosenDir) {
        try {
          await downloadWithFS(u);
        } catch (e) { /* fallback níže */ }
      } else {
        await downloadViaAPI(u);
      }
      updateBar();
      timer = setTimeout(stepDownload, delayMs);
    }

    async function startOrPause(){
      if (running) { paused=true; stopRun('paused'); return; }

      urls = collectUrls();
      idx = 0;
      if (!urls.length) { el.note.textContent = TXT[lang].nothing; return; }

      delayMs = Math.max(200, parseInt(el.delay.value,10) || 1500);
      maxCount = Math.max(1, Math.min(HARD_CAP, parseInt(el.limit.value,10) || HARD_CAP));
      urls = urls.slice(0, maxCount);

      running=true; paused=false;
      el.toggle.textContent=TXT[lang].pause;
      const st = { running:true, total: urls.length, opened: 0, delayMs };
      GM_Set(STATE_KEY, st);

      if (viewMode === 'open') stepOpen();
      else stepDownload();
    }

    // ---------- DOWNLOAD ----------
    function guessExtFromType(ct){ if (!ct) return ''; ct=ct.toLowerCase();
      if (ct.includes('jpeg')) return '.jpg';
      if (ct.includes('png'))  return '.png';
      if (ct.includes('gif'))  return '.gif';
      if (ct.includes('webp')) return '.webp';
      if (ct.includes('avif')) return '.avif';
      if (ct.includes('mp4'))  return '.mp4';
      if (ct.includes('webm')) return '.webm';
      return '';
    }
    function safeName(name){ return name.replace(/[\\/:*?"<>|]+/g,'_').replace(/\s+/g,' ').trim() || 'file'; }
    function fileNameFromUrl(u){ try {
      const url=new URL(u,location.href); const last=decodeURIComponent(url.pathname.split('/').pop()||'file');
      return safeName(last.split('?')[0].split('#')[0]);
    } catch { return 'file'; } }

    async function fsWriteFile(dir, name, arrayBuffer){
      const fh = await dir.getFileHandle(name, { create: true });
      const w = await fh.createWritable();
      await w.write(arrayBuffer);
      await w.close();
    }

    async function downloadWithFS(url) {
      try {
        activeAbort = new AbortController();
        const resp = await fetch(url, { signal: activeAbort.signal, credentials: 'include' });
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        const ct = resp.headers.get('content-type') || '';
        const ext = guessExtFromType(ct) || '.' + (fileNameFromUrl(url).split('.').pop() || 'dat');
        const base = fileNameFromUrl(url).replace(/\.[a-z0-9]+$/i,'');
        const name = safeName(base) + ext;
        const buf = await resp.arrayBuffer();
        await fsWriteFile(lastChosenDir, name, buf);
      } finally {
        activeAbort = null;
      }
    }

    async function downloadViaAPI(url) {
      const filename = fileNameFromUrl(url);
      try {
        await new Promise((resolve) => {
          chrome.runtime.sendMessage({ type:'download', url, filename }, () => resolve());
        });
      } catch {}
    }

    // ---------- Sdílený stav pro sidebar ----------
    function renderStatsShared(){
      const s = GM_Get(STATE_KEY) || {};
      const total = s.total || 0;
      const opened = Math.min(s.opened || 0, total);
      const left = Math.max(0, total - opened);
      const per = total ? Math.round((opened/total)*100) : 0;
      el.fill.style.width = per + '%';
      const hasG = hasGrid();
      el.toggle.disabled = !hasG; el.toggle.style.opacity = hasG ? 1 : .5;
      el.note.textContent = s.note || (s.running ? TXT[lang].running : (total>0 && left===0 ? TXT[lang].done : TXT[lang].ready));
      if (!running) el.toggle.textContent = s.running ? TXT[lang].pause : (viewMode==='open'?TXT[lang].startOpen:TXT[lang].startDownload);
      const etaSec = ((left||0) * (s.delayMs || 1500)) / 1000 | 0;
      el.stats.textContent = `${opened}/${total} | ${TXT[lang].eta} ${fmtSec(etaSec)}`;
      el.miniTxt && (el.miniTxt.textContent = `${left} | ${TXT[lang].eta} ${fmtSec(etaSec)}`);
    }
    try {
      GM_addValueChangeListener(STATE_KEY, (_k,_o,_n)=>{ let obj=null; try{ obj=typeof _n === 'string' ? JSON.parse(_n) : _n; }catch{}; if(!running && obj) renderStatsShared(); });
    } catch {}

    // ---------- Handlery UI ----------
    el.lang.addEventListener('click', (e) => {
      e.preventDefault();
      lang = (lang === 'cs') ? 'en' : 'cs';
      GM_Set(LANG_KEY, lang);
      applyLangTexts();
    }, true);

    el.view.addEventListener('click', (e) => { e.preventDefault(); setView(viewMode === 'open' ? 'download' : 'open'); });

    // SFW button toggle
    el.sfw.addEventListener('click', (e) => { e.preventDefault(); setSfw(!sfwEnabled()); }, true);

    el.cset.addEventListener('click', (e) => { e.preventDefault(); setSettingsCollapsed(!settingsCollapsed); applyLangTexts(); }, true);

    el.min.addEventListener('click', e=>{ e.preventDefault(); const vis = el.body.style.display !== 'none'; el.body.style.display = vis ? 'none' : ''; el.cset.classList.toggle(HIDDEN_CLASS, !vis); el.mini.style.display = vis ? '' : 'none'; }, true);

    el.close.addEventListener('click', e=>{ e.preventDefault(); box.remove(); }, true);

    el.toggle.addEventListener('click', e=>{ swallow(e); startOrPause(); }, true);

    el.stop.addEventListener('click',   e=>{ swallow(e); urls=[]; idx=0; stopRun('paused'); }, true);

    el.chooseDir.addEventListener('click', async (e) => {
      swallow(e);
      try {
        const dir = await window.showDirectoryPicker({ mode:'readwrite' });
        lastChosenDir = dir;
        lastChosenDirName = dir.name || '…';
        el.dirLabel.textContent = TXT[lang].folderChosen(lastChosenDirName);
        el.note.textContent = TXT[lang].ready;
      } catch {
        lastChosenDir = null; lastChosenDirName = '';
        el.dirLabel.textContent = TXT[lang].folderDefault;
        el.note.textContent = TXT[lang].fsCancel;
      }
    }, true);

    const gridPresent = hasGrid();
    if (!gridPresent){
      el.toggle.disabled = true; el.toggle.style.opacity = .5;
      el.stats.textContent = TXT[lang].noGallery;
    }

    // ---------- INIT ----------
    // výchozí popisky dle aktuálního zvoleného módu
    el.lblDelay.textContent = (viewMode==='open' ? TXT[lang].delayLabelOpen : TXT[lang].delayLabelDownload);
    el.lblLimit.textContent = (viewMode==='open' ? TXT[lang].limitLabelOpen : TXT[lang].limitLabelDownload);
    el.grpDest.style.display = (viewMode === 'download') ? 'block' : 'none';

    updateBar();
    applyLangTexts();
  });
})();
