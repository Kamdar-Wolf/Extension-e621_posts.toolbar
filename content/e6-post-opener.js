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
    try{ chrome.runtime.sendMessage({type:'openInBackground', url, options:opts||{}}, ()=>{}); }
    catch{ try{ window.open(url,'_blank','noopener'); }catch{} }
  }
  function GM_download(opts){
    const { url, name, onload, onerror } = (typeof opts==='string') ? {url:opts} : opts;
    chrome.runtime.sendMessage({ type:'download', url, filename:name }, (res)=>{
      const e = chrome.runtime.lastError;
      if (e) return onerror && onerror(e);
      if (!res?.ok) return onerror && onerror(new Error(res?.error||'download failed'));
      onload && onload(res);
    });
  }

  __onReady(function init(){
    if (!/^\/posts(\/|\?|$)/.test(location.pathname)) return;
    if (!document.querySelector('article.thumbnail')) return;

    // ---------- KONSTANTY/UI ----------
    const SELECTOR_CARD = 'article.thumbnail';
    const ATTR_FILE_URL = 'data-file-url';
    const hasGrid = !!document.querySelector(SELECTOR_CARD);

    const DEFAULT_LIMIT = 2000;
    const HARD_CAP = 2000;

    const UI_BORDER = '#ffee95';
    const UI_WIDTH  = '215px';
    const FONT_STACK = 'Verdana, system-ui, Segoe UI, Roboto, Arial, sans-serif';

    // ---------- STAV ----------
    let delayMs = 1500;
    let modeVal  = 'post';                      // pro OTEVÍRÁNÍ: 'post' | 'file'
    let viewMode = (GM_getValue('kd_view_mode') || 'open'); // 'open' | 'download'
    let running = false, paused = false, timer = null;
    let urls = []; let idx = 0;

    // DOWNLOAD
    let dirHandle = null;  // File System Access API directory handle (volitelné)
    let activeAbort = null;
    let lastChosenDirName = '';

    // Nastavení UI
    let settingsCollapsed = true;
    const HIDDEN_CLASS = 'kd-hidden';

    // ----- BURST settings -----
    const BURST_MODE_KEY = 'kd_burst_mode';     // '0' | '1'
    const BURST_STEP_KEY = 'kd_burst_step_ms';  // number (ms)
    let burstMode  = (GM_getValue(BURST_MODE_KEY) === '1'); // default off
    let burstStepMs = Math.max(200, parseInt(GM_getValue(BURST_STEP_KEY) || '1500', 10));

    // ---------- I18N ----------
    const LANG_KEY = 'kd_lang';
    let lang = (GM_getValue(LANG_KEY) || 'cs'); // 'cs' | 'en'

    const TXT = {
      cs: {
        titleOpen: 'Otevřít',
        titleDownload: 'Stáhnout',
        gear: 'Sbalit/rozbalit nastavení',
        gearExpand: 'Rozbalit nastavení',
        gearCollapse: 'Sbalit nastavení',
        minimize: 'Minimalizovat',
        close: 'Zavřít',
        sfw: 'Přepnout SFW (\\)',
        viewOpen: 'Přepnout na stahování',
        viewDownload: 'Přepnout na otevírání',
        modeLabel: 'Režim',
        modePost: 'post (stránka příspěvku)',
        modeFile: 'file (plný soubor)',
        delayLabelOpen: 'Prodleva mezi otevřeními (ms)',
        delayLabelDownload: 'Prodleva mezi staženími (ms)',
        limitLabelOpen:  `Počet otevření (max ${HARD_CAP})`,
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
        nothing: 'Nic k otevření/stahování.',
        next: 'Next',
        eta: 'ETA',
        noGallery: 'Na téhle stránce není galerie.',
        statusOpen: (o,t,l) => `Otevřeno: ${o}/${t} | Zbývá: ${l}`,
        statusDownload: (o,t,l) => `Staženo: ${o}/${t} | Zbývá: ${l}`,
        langToggle: 'Přepnout jazyk CZ/EN',
        noFS: 'Prohlížeč nedovolil přímý výběr složky. Použiji výchozí „Stažené soubory“.',
        fsDenied: 'Oprávnění k zápisu odepřeno. Použiji výchozí „Stažené soubory“.',
        fsCancel: 'Výběr složky zrušen nebo selhal. Použiji výchozí „Stažené soubory“.',
        dlError: 'Chyba stahování',
        runningElsewhere: 'Probíhá jinde',

        // --- nové pro Burst ---
        burstStyle: 'Styl otevírání',
        burstOff: 'Sekvenčně',
        burstOn: 'Hromadně',
        burstStep: 'Odpočet mezi kartami (ms)'
      },
      en: {
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
        destLabel: 'Target folder',
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
        nothing: 'Nothing to open/download.',
        next: 'Next',
        eta: 'ETA',
        noGallery: 'No gallery on this page.',
        statusOpen: (o,t,l) => `Opened: ${o}/${t} | Left: ${l}`,
        statusDownload: (o,t,l) => `Downloaded: ${o}/${t} | Left: ${l}`,
        langToggle: 'Toggle language CZ/EN',
        noFS: 'Browser did not allow direct folder selection. Using default Downloads.',
        fsDenied: 'Write permission denied. Using default Downloads.',
        fsCancel: 'Folder selection canceled/failed. Using default Downloads.',
        dlError: 'Download error',
        runningElsewhere: 'Running elsewhere',

        // --- new for Burst ---
        burstStyle: 'Opening style',
        burstOff: 'Sequential',
        burstOn: 'All at once with countdown',
        burstStep: 'Countdown between tabs (ms)'
      }
    };
    const t = (key, ...args) => (typeof TXT[lang][key] === 'function' ? TXT[lang][key](...args) : TXT[lang][key]);
    const titleForView = () => (viewMode === 'open' ? t('titleOpen') : t('titleDownload')) ;


    // ---------- SHARED STATE ----------
    const STATE_KEY = 'kd_safe_status';
    const GM_Get = (k) => { try { return GM_getValue(k); } catch { return null; } };
    const GM_Set = (k,v) => { try { GM_setValue(k,v); } catch {} };

    function readShared() { try { const raw = GM_Get(STATE_KEY); return raw ? JSON.parse(raw) : {}; } catch { return {}; } }
    function writeShared(obj){ try { GM_Set(STATE_KEY, JSON.stringify(obj || {})); } catch {} }

    let shared = readShared();
    function publishLocalStatus(noteOverride) {
      const total = urls.length;
      const opened = Math.min(idx, total);
      writeShared({
        running, total, opened, delayMs, viewMode,
        startedAt: shared.startedAt || (running ? Date.now() : null),
        lastTick: Date.now(),
        note: (noteOverride != null)
          ? noteOverride
          : (running ? (paused ? t('paused') : t('running')) : (opened===total && total>0 ? t('done') : t('ready'))),
      });
    }

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

// ------- SFW HOTKEY – nastav tady --------
// PŘÍKLADY PRESETŮ (nech jen JEDEN aktivní):
// 1) Jen fyzická klávesa "\" (stabilní na CZ/EN):
	const HOTKEY = { useCode:true, code:'Backslash', ctrl:false, alt:false, shift:false, meta:false };

// 2) Shift + "\":
	// const HOTKEY = { useCode:true, code:'Backslash', shift:true };

// 3) Ctrl + Alt + S (pozor na AltGr=Ctrl+Alt):
	// const HOTKEY = { useCode:true, code:'KeyS', ctrl:true, alt:true };

// 4) Jen písmeno "s" podle rozložení (CZ/EN závislé):
	// const HOTKEY = { useCode:false, key:'s' };

// 5) F2:
	// const HOTKEY = { useCode:true, code:'F2' };

// -----------------------------------------

function matchesHotkey(e) {
  // ignoruj psaní do políček
  const tag = (e.target?.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target?.isContentEditable) return false;

  // ověř hlavní klávesu
  let mainOk = false;
  if (HOTKEY.useCode) {
    // porovnává fyzickou klávesu (KeyS, Backslash, F2, ...)
    mainOk = e.code === HOTKEY.code;
  } else {
    // porovnává znak podle rozložení (např. 's' nebo '\\')
    const want = (HOTKEY.key || '').toLowerCase();
    mainOk = (e.key || '').toLowerCase() === want;
  }

  // ověř modifikátory (true = musí být stisknutý, false = nesmí být stisknutý)
  const modsOk =
    (!!HOTKEY.ctrl  === !!e.ctrlKey)  &&
    (!!HOTKEY.alt   === !!e.altKey)   &&
    (!!HOTKEY.shift === !!e.shiftKey) &&
    (!!HOTKEY.meta  === !!e.metaKey);

  return mainOk && modsOk;
}

// --- SFW hotkey handler ---
if (!window.__kd_sfwHotkeyBound) {
  window.__kd_sfwHotkeyBound = true;
  document.addEventListener('keydown', (e) => {
    if (!matchesHotkey(e)) return;
    e.preventDefault();
    try { setSfw(!sfwEnabled()); } catch {}
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
      fontFamily: FONT_STACK,
      fontSize:'12px',
      padding:'10px 10px',
      border:`1px solid ${UI_BORDER}`,
      borderRadius:'8px',
      boxShadow:'none',
      pointerEvents:'auto'
    });
    box.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;gap:6px;">
        <div style="display:flex;align-items:center;gap:6px;min-width:0;">
          <button id="e6-lang" type="button" title="${t('langToggle')}"
                  style="all:unset;cursor:pointer;font-size:16px;line-height:1;display:flex;align-items:center">${lang==='cs'?'🇨🇿':'🇬🇧'}</button>
          <strong id="e6-title" style="font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${titleForView()}</strong>
        </div>
        <div style="display:flex;gap:6px;align-items:center;flex-shrink:0;">
          <button id="e6-sfw"   type="button" title="${t('sfw')}" style="all:unset;cursor:pointer;opacity:.9;">🛡️</button>
          <button id="e6-view"  type="button" title="${viewMode==='open'?t('viewOpen'):t('viewDownload')}" style="all:unset;cursor:pointer;opacity:.9;">${viewMode==='open'?'⬇️':'🔗'}</button>
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
            <div id="lbl-delay" style="margin-bottom:2px;">${viewMode==='open'?t('delayLabelOpen'):t('delayLabelDownload')}</div>
            <input id="e6-delay" type="number" min="200" step="100" value="1500"
                   style="width:100%;padding:5px;border-radius:6px;background:#111;border:none;color:inherit;">
          </div>
          <div id="grp-limit">
            <div id="lbl-limit" style="margin-bottom:2px;">${viewMode==='open'?t('limitLabelOpen'):t('limitLabelDownload')}</div>
            <input id="e6-limit" type="number" min="1" step="1" placeholder="${DEFAULT_LIMIT}"
                   style="width:100%;padding:5px;border-radius:6px;background:#111;border:none;color:inherit;">
          </div>

          <div id="grp-dest" style="display:${viewMode==='download'?'block':'none'};">
            <div id="lbl-dest" style="margin-bottom:2px;">${t('destLabel')}</div>
            <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
              <button id="e6-choose-dir" type="button"
                      style="padding:6px 8px;border-radius:8px;background:#ffee95;border:none;color:#111;cursor:pointer;">${t('chooseFolder')}</button>
              <span id="e6-dir-label" style="opacity:.95;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1 1 auto;">${t('folderDefault')}</span>
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
                  style="flex:1;padding:6px 8px;border-radius:8px;background:#1b6e1b;border:none;color:#fff;cursor:pointer;">${viewMode==='open'?t('startOpen'):t('startDownload')}</button>
          <button id="e6-stop"   type="button"
                  style="flex:1;padding:6px 8px;border-radius:8px;background:#7a1b1b;border:none;color:#fff;cursor:pointer;">${t('stop')}</button>
        </div>

        <div id="e6-note" style="margin-top:6px;opacity:.95;">${t('ready')}</div>
      </div>

      <div id="e6-mini" style="display:none;opacity:.95;">(min) <span id="e6-mini-text">0 | ${t('eta')} 0s</span></div>
    `;

    // Mount do sidebaru / fallback
    function findSidebar(){ return document.querySelector('.sidebar, #sidebar, aside.sidebar, #tag-sidebar, .post-sidebar'); }
    function mountInSidebar(){
      const sb = findSidebar(); if (!sb) return false;
      if (box.parentNode && box.parentNode !== sb) box.parentNode.remove();
      const modeBox = sb.querySelector('#mode-box');
      const blacklistUI = sb.querySelector('.blacklist-ui');
      if (modeBox && blacklistUI) sb.insertBefore(box, blacklistUI);
      else if (modeBox?.nextElementSibling) sb.insertBefore(box, modeBox.nextElementSibling);
      else sb.insertBefore(box, sb.firstChild);
      return true;
    }
    let mounted = mountInSidebar();
    if (!mounted) {
      const mo = new MutationObserver(()=>{ if (mountInSidebar()) mo.disconnect(); });
      mo.observe(document.body, { childList:true, subtree:true });
    }
    addEventListener('popstate', mountInSidebar);
    document.addEventListener('pjax:end', mountInSidebar);
    document.addEventListener('turbo:load', mountInSidebar);
    setTimeout(() => {
      if (!box.isConnected) {
        Object.assign(box.style, { position:'fixed', right:'12px', top:'12px', width: UI_WIDTH, zIndex: 999999 });
        document.body.appendChild(box);
      }
    }, 1200);

    // ---------- ELEMENTY ----------
    const $ = s => box.querySelector(s);
    const el = {
      lang: $('#e6-lang'), title: $('#e6-title'), view: $('#e6-view'),
      cset: $('#e6-cset'), min: $('#e6-min'), close: $('#e6-close'),
      body: $('#e6-body'), settings: $('#e6-settings'),
      mini: $('#e6-mini'), miniTxt: $('#e6-mini-text'),
      grpMode: $('#grp-mode'), grpDest: $('#grp-dest'),
      lblMode: $('#lbl-mode'), lblDelay: $('#lbl-delay'),
      lblLimit: $('#lbl-limit'), lblDest: $('#lbl-dest'),
      mode: $('#e6-mode'), delay: $('#e6-delay'), limitI: $('#e6-limit'),
      fill: $('#e6-fill'), stats: $('#e6-stats'), stats2: $('#e6-stats2'),
      toggle: $('#e6-toggle'), stop: $('#e6-stop'), note: $('#e6-note'),
      sfw: $('#e6-sfw'), chooseDir: $('#e6-choose-dir'), dirLabel: $('#e6-dir-label'),
    };

    // ---- BURST UI (wrap + překlady) ----
    const grpBurst = document.createElement('div');
    grpBurst.id = 'grp-burst';
    grpBurst.style.marginTop = '6px';
    grpBurst.innerHTML = `
      <div id="lbl-burst-style" style="margin-bottom:2px;"></div>
      <label style="display:flex;align-items:flex-start;gap:6px;margin-bottom:4px;">
        <input id="kd-burst-off" type="radio" name="kd-burst" value="0">
        <span id="txt-burst-off"></span>
      </label>
      <label style="display:flex;align-items:flex-start;gap:6px;margin-bottom:6px;">
        <input id="kd-burst-on" type="radio" name="kd-burst" value="1">
        <span id="txt-burst-on"></span>
      </label>
      <div id="grp-burst-step">
        <div id="lbl-burst-step" style="margin-bottom:2px;"></div>
        <input id="kd-burst-step" type="number" min="200" step="100"
               style="width:100%;padding:5px;border-radius:6px;background:#111;border:none;color:inherit;">
      </div>
    `;
    el.settings.appendChild(grpBurst);
    const rbOff  = grpBurst.querySelector('#kd-burst-off');
    const rbOn   = grpBurst.querySelector('#kd-burst-on');
    const stepIn = grpBurst.querySelector('#kd-burst-step');
    const stepWrap = grpBurst.querySelector('#grp-burst-step');
    const lblBurstStyle = grpBurst.querySelector('#lbl-burst-style');
    const lblBurstStep  = grpBurst.querySelector('#lbl-burst-step');
    const txtBurstOff   = grpBurst.querySelector('#txt-burst-off');
    const txtBurstOn    = grpBurst.querySelector('#txt-burst-on');

    // init stav
    rbOff.checked = !burstMode;
    rbOn.checked  = burstMode;
    stepWrap.style.display = burstMode ? 'block' : 'none';
    stepIn.value = String(burstStepMs);

    rbOff.addEventListener('change', () => {
      burstMode = false; GM_Set(BURST_MODE_KEY, '0'); stepWrap.style.display = 'none';
    });
    rbOn.addEventListener('change', () => {
      burstMode = true;  GM_Set(BURST_MODE_KEY, '1'); stepWrap.style.display = 'block';
    });
    stepIn.addEventListener('change', () => {
      const v = Math.max(200, parseInt(stepIn.value,10) || 1500);
      burstStepMs = v; GM_Set(BURST_STEP_KEY, String(v));
    });

    // ---------- Ovládání UI ----------
    function setSettingsCollapsed(collapsed){
      settingsCollapsed = collapsed;
      el.settings.classList.toggle(HIDDEN_CLASS, collapsed);
      el.cset.style.opacity = collapsed ? '0.55' : '0.85';
      el.cset.title = collapsed ? t('gearExpand') : t('gearCollapse');
    }
    setSettingsCollapsed(true);

    function setView(nextMode) {
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
        el.note.textContent = TXT[lang].ready; el.stats.textContent = TXT[lang].ready; el.stats2.textContent = '';
      }
      el.miniTxt && (el.miniTxt.textContent = `0 | ${TXT[lang].eta} 0s`);

      // ---- burst texty (fix překladů) ----
      lblBurstStyle.textContent = t('burstStyle');
      txtBurstOff.textContent   = t('burstOff');
      txtBurstOn.textContent    = t('burstOn');
      lblBurstStep.textContent  = t('burstStep');
    }

    el.lang.addEventListener('click', (e) => {
      e.preventDefault();
      lang = (lang === 'cs') ? 'en' : 'cs';
      GM_Set(LANG_KEY, lang);
      applyLangTexts();
    });

    el.view.addEventListener('click', (e) => { e.preventDefault(); setView(viewMode === 'open' ? 'download' : 'open'); });
    el.cset.addEventListener('click', (e) => { e.preventDefault(); setSettingsCollapsed(!settingsCollapsed); applyLangTexts(); }, true);
    setView(viewMode);

    // mini / close
    el.min.addEventListener('click', e=>{ e.preventDefault(); const vis = !el.body.classList.contains(HIDDEN_CLASS); el.body.classList.toggle(HIDDEN_CLASS, vis); el.mini.style.display = vis ? '' : 'none'; }, true);
    el.close.addEventListener('click', e=>{ e.preventDefault(); box.remove(); }, true);

    // ---------- URL HELPERY ----------
    const toAbs = href => new URL(href, location.href).href;
    const isFileUrl = u => { try {
      const url = new URL(u, location.href);
      const p = url.pathname.toLowerCase();
      return /\.(png|jpe?g|gif|webp|webm|mp4|avif)$/.test(p) || url.hostname.startsWith('static');
    } catch { return false; } };
    function pickPostHref(card){
      const as=[...card.querySelectorAll('a[href]')];
      let a=as.find(x=>/\/posts\//i.test(x.getAttribute('href')) && !isFileUrl(x.href)); if (a) return toAbs(a.getAttribute('href'));
      a=as.find(x=>x.hostname===location.hostname && !isFileUrl(x.href)); if (a) return toAbs(a.getAttribute('href'));
      return as[0]?toAbs(as[0].getAttribute('href')):null;
    }
    function pickFileHref(card){
      const u=card.dataset.fileUrl||card.getAttribute(ATTR_FILE_URL);
      if (u) return toAbs(u);
      const img=card.querySelector('img'); if (img?.src) return img.src;
      return pickPostHref(card);
    }
    function collectUrlsOpen(mode, limitVal){
      let list=[...document.querySelectorAll(SELECTOR_CARD)]
        .map(c=>mode==='post'?pickPostHref(c):pickFileHref(c)).filter(Boolean);
      list=[...new Set(list)];
      if (Number.isFinite(limitVal) && limitVal>0) list = list.slice(0, limitVal);
      return list;
    }
    function collectUrlsDownload(limitVal){
      let list=[...document.querySelectorAll(SELECTOR_CARD)]
        .map(c=>pickFileHref(c)).filter(Boolean);
      list=[...new Set(list)];
      if (Number.isFinite(limitVal) && limitVal>0) list = list.slice(0, limitVal);
      return list;
    }

    // ---------- OTEVÍRÁNÍ ----------
    function openInBackground(u){
      try { GM_openInTab(u, {active:false, insert:true, setParent:true}); }
      catch {
        const a=document.createElement('a');
        a.href=u; a.target='_blank'; a.rel='noopener noreferrer'; document.body.appendChild(a);
        const ev=new MouseEvent('click',{view:window,bubbles:true,cancelable:true,ctrlKey:true});
        a.dispatchEvent(ev); a.remove();
      }
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
        let name = fileNameFromUrl(url);
        if (!/\.\w{2,5}$/.test(name)) { const ext = guessExtFromType(resp.headers.get('content-type')||''); if (ext) name += ext; }
        const buf = await resp.arrayBuffer(); activeAbort = null;
        await fsWriteFile(dirHandle, name, buf);
        return true;
      } catch (e) {
        try {
          await new Promise((resolve, reject) => {
            const name = fileNameFromUrl(url);
            chrome.runtime.sendMessage({ type: 'download', url, filename: name }, (res) => {
              const er = chrome.runtime.lastError;
              if (er) reject(er);
              else if (!res?.ok) reject(new Error(res?.error||'download failed'));
              else resolve();
            });
          });
          return true;
        } catch { return false; }
      }
    }

    function downloadWithDownloadsAPI(url){
      return new Promise((resolve, reject) => {
        const name = fileNameFromUrl(url);
        try {
          chrome.runtime.sendMessage({ type: 'download', url, filename: name }, (res) => {
            if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
            else if (!res || !res.ok) reject(new Error(res && res.error ? res.error : 'download failed'));
            else resolve();
          });
        } catch (e) { reject(e); }
      });
    }

    async function downloadOne(url){
      try {
        if (dirHandle && typeof dirHandle.getFileHandle === 'function') {
          const ok = await downloadWithFS(url);
          if (ok) return true;
          await downloadWithDownloadsAPI(url);
          return true;
        } else {
          await downloadWithDownloadsAPI(url);
          return true;
        }
      } catch { return false; }
    }

    // ---------- STATISTIKY/UI STAV ----------
    function fmtSec(s){ s=Math.max(0,Math.ceil(s)); const m=(s/60)|0, r=s%60; return m?`${m}m ${r}s`:`${r}s`; }
    function renderStats(opened,total,left,isRunning,delay){
      const next = isRunning && !paused ? (delay/1000) : 0;
      const etaSec = left * (delay/1000);
      const line = (viewMode==='open') ? TXT[lang].statusOpen(opened,total,left) : TXT[lang].statusDownload(opened,total,left);
      el.stats.textContent = isRunning ? line : (opened===total && total>0) ? TXT[lang].done : TXT[lang].ready;
      el.stats2.textContent = total>0 ? `${TXT[lang].next}: ${next.toFixed(1)}s | ${TXT[lang].eta}: ${fmtSec(etaSec)}` : '';
      el.miniTxt && (el.miniTxt.textContent = `${left} | ${TXT[lang].eta} ${fmtSec(etaSec)}`);
    }
    function renderFromShared(s){
      const total = s.total || 0;
      const opened = Math.min(s.opened || 0, total);
      const left = Math.max(0, total - opened);
      const per = total ? Math.round((opened/total)*100) : 0;
      el.fill.style.width = per + '%';
      el.toggle.disabled = !hasGrid; el.toggle.style.opacity = hasGrid ? 1 : .5;
      el.note.textContent = s.note || (s.running ? TXT[lang].running : (total>0 && left===0 ? TXT[lang].done : TXT[lang].ready));
      if (!running) el.toggle.textContent = s.running ? TXT[lang].runningElsewhere : (viewMode==='open'?TXT[lang].startOpen:TXT[lang].startDownload);
      renderStats(opened,total,left, !!s.running, s.delayMs || 1500);
    }
    try {
      GM_addValueChangeListener(STATE_KEY, (_k,_o,_n)=>{ let obj=null; try{ obj=typeof _n === 'string' ? JSON.parse(_n||'{}') : _n; }catch{}; if(!running && obj) renderFromShared(obj); });
    } catch {}

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
      el.toggle.disabled = !hasGrid;
      el.note.textContent=TXT[lang][noteKey] || TXT[lang].paused;
      updateBar(); publishLocalStatus(TXT[lang][noteKey] || TXT[lang].paused);
    }

    async function tickOpen(){
      if (!running || paused) return;
      if (idx >= urls.length){ stopRun('done'); return; }
      openInBackground(urls[idx++]); updateBar(); publishLocalStatus();
      if (idx >= urls.length){ stopRun('done'); return; }
      timer = setTimeout(tickOpen, delayMs);
    }
    async function tickDownload(){
      if (!running || paused) return;
      if (idx >= urls.length){ stopRun('done'); return; }
      const ok = await downloadOne(urls[idx]); idx++; updateBar(); publishLocalStatus(ok ? undefined : TXT[lang].dlError);
      if (idx >= urls.length){ stopRun('done'); return; }
      timer = setTimeout(tickDownload, delayMs);
    }

    function startOrPause(){
      if (!hasGrid) return;
      if (!running){
        modeVal = (viewMode==='open') ? el.mode.value : 'file';
        const d = parseInt(el.delay.value,10); delayMs = Number.isFinite(d)&&d>=200 ? d : delayMs;
        const l = parseInt(el.limitI.value,10); const want = Number.isFinite(l)&&l>0 ? l : DEFAULT_LIMIT;

        let found = (viewMode==='open') ? collectUrlsOpen(modeVal, want) : collectUrlsDownload(want);
        if (found.length > HARD_CAP) found = found.slice(0, HARD_CAP);

        if (!found.length){
          el.note.textContent = TXT[lang].nothing; publishLocalStatus(TXT[lang].nothing); return;
        }

        // ---- BURST režim: předání seznamu a kroku backgroundu (s alarmy)
        if (viewMode === 'open' && burstMode) {
          try {
            el.note.textContent = TXT[lang].running;
            el.stats.textContent = `Burst: připravuji ${found.length} karet…`;
            chrome.runtime.sendMessage({ type: 'burstOpen', urls: found, stepMs: burstStepMs }, (res) => {
              const e = chrome.runtime.lastError;
              if (e) {
                el.stats.textContent = 'Chyba: ' + e.message;
                el.note.textContent = TXT[lang].paused;
                publishLocalStatus('error');
              } else if (!res || !res.ok) {
                el.stats.textContent = 'Chyba: ' + (res && res.error ? res.error : 'burst failed');
                el.note.textContent = TXT[lang].paused;
                publishLocalStatus('error');
              } else {
                el.fill.style.width = '100%';
                el.stats.textContent = `Burst vytvořen: ${res.created} karet. Odpočty běží v titulcích.`;
                el.note.textContent = TXT[lang].done;
                publishLocalStatus(TXT[lang].done);
              }
            });
          } catch (err) {
            el.stats.textContent = 'Chyba: ' + (err && err.message ? err.message : err);
            el.note.textContent = TXT[lang].paused;
            publishLocalStatus('error');
          }
          return; // konec – žádná sekvenční smyčka
        }

        // ---- OPEN: sekvenční otevírání jede přes background (chrome.alarms), aby to
        // na pozadí nespadlo na ~30s throttling. Content script jen zobrazuje progres.
        if (viewMode === 'open') {
          urls = found; idx = 0; running = true; paused = false;
          el.toggle.textContent = TXT[lang].pause;
          el.note.textContent = TXT[lang].running;
          updateBar();
          publishLocalStatus(TXT[lang].running);

          chrome.runtime.sendMessage({ type: 'seqOpenStart', urls: found, delayMs }, (res) => {
            const e = chrome.runtime.lastError;
            if (e || !res?.ok) {
              stopRun('paused');
              el.stats.textContent = 'Chyba: ' + (e?.message || res?.error || 'seq start failed');
              publishLocalStatus('error');
              return;
            }
            // čekáme na seqProgress zprávy z backgroundu
          });
          return;
        }

        // ---- DOWNLOAD: zůstává lokálně (FS API běží v contentu)
        urls = found; idx = 0; running = true; paused = false;
        el.toggle.textContent=TXT[lang].pause; el.note.textContent=TXT[lang].running;
        updateBar(); publishLocalStatus(TXT[lang].running);
        timer = setTimeout(tickDownload, delayMs);
        return;
      }

      // toggle pauzy
      if (!paused){
        paused = true; el.toggle.textContent=TXT[lang].resume; el.note.textContent=TXT[lang].paused;
        if (viewMode === 'open') {
          chrome.runtime.sendMessage({ type: 'seqOpenPause' }, () => {});
        } else {
          clearTimeout(timer); timer=null; if (activeAbort) { try { activeAbort.abort(); } catch {} activeAbort=null; }
        }
        updateBar(); publishLocalStatus(TXT[lang].paused);
      } else {
        paused = false; el.toggle.textContent=TXT[lang].pause; el.note.textContent=TXT[lang].running;
        updateBar(); publishLocalStatus(TXT[lang].running);
        if (viewMode === 'open') {
          chrome.runtime.sendMessage({ type: 'seqOpenResume' }, () => {});
        } else {
          timer = setTimeout(tickDownload, delayMs);
        }
      }
    }

    function swallow(e){ e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); }
    el.toggle.addEventListener('click', e=>{ swallow(e); startOrPause(); }, true);
    el.stop.addEventListener('click',   e=>{
      swallow(e);
      if (viewMode === 'open') {
        chrome.runtime.sendMessage({ type: 'seqOpenStop' }, () => {});
      }
      urls=[]; idx=0; stopRun('paused');
    }, true);

    // ---------- VÝBĚR SLOŽKY ----------
    async function pickDirectoryHandle(){
      const pickerHost = (typeof window.showDirectoryPicker === 'function') ? window : null;
      if (!pickerHost) throw new Error('noPicker');

      let handle = null;
      try { handle = await pickerHost.showDirectoryPicker({ startIn: 'downloads' }); }
      catch { handle = await pickerHost.showDirectoryPicker(); }

      if (handle.queryPermission) {
        let p = await handle.queryPermission({ mode: 'readwrite' });
        if (p !== 'granted' && handle.requestPermission) {
          p = await handle.requestPermission({ mode: 'readwrite' });
          if (p !== 'granted') throw new Error('permDenied');
        }
      } else if (handle.requestPermission) {
        const p = await handle.requestPermission({ mode: 'readwrite' });
        if (p !== 'granted') throw new Error('permDenied');
      }
      return handle;
    }

    el.chooseDir.addEventListener('click', async (e) => {
      e.preventDefault();
      try {
        const handle = await pickDirectoryHandle();
        dirHandle = handle;
        lastChosenDirName = handle?.name || '';
        el.dirLabel.textContent = lastChosenDirName ? TXT[lang].folderChosen(lastChosenDirName) : TXT[lang].folderDefault;
        el.note.textContent = TXT[lang].ready;
      } catch (err) {
        dirHandle = null; lastChosenDirName = '';
        if (err && err.message === 'noPicker') { el.dirLabel.textContent = TXT[lang].folderDefault; el.note.textContent = TXT[lang].noFS; }
        else if (err && (err.message === 'permDenied')) { el.dirLabel.textContent = TXT[lang].folderDefault; el.note.textContent = TXT[lang].fsDenied; }
        else { el.dirLabel.textContent = TXT[lang].folderDefault; el.note.textContent = TXT[lang].fsCancel; }
      }
    }, true);

    if (!hasGrid){
      el.toggle.disabled = true; el.toggle.style.opacity = .5;
      el.stats.textContent = TXT[lang].noGallery;
    }

    // ---------- INIT ----------
    if (!running) { shared = readShared(); if (shared && typeof shared === 'object') renderFromShared(shared); }
    const paintSfwBtn = ()=>{ if (el.sfw) el.sfw.style.opacity = sfwEnabled() ? '1' : '.35'; };
    el.sfw.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); setSfw(!sfwEnabled()); paintSfwBtn(); }, true);
    addEventListener('keydown', (e) => { if (e.key === '\\') { e.preventDefault(); setSfw(!sfwEnabled()); paintSfwBtn(); } });
    paintSfwBtn();

    // --- PROGRES Z BACKGROUNDu (SEQ OPEN) ---
    try {
      chrome.runtime.onMessage.addListener((msg) => {
        if (!msg || !msg.type) return;

        if (msg.type === 'seqProgress') {
          // background otevírá URL, content jen zobrazuje progres
          const total = Number(msg.total || (urls ? urls.length : 0)) || 0;
          const opened = Number(msg.opened || 0) || 0;
          const pausedNow = !!msg.paused;
          const d = Number(msg.delayMs || delayMs) || delayMs;

          if (!urls || !urls.length) {
            // fallback: kdyby se něco pokazilo, ať UI aspoň sedí
            urls = new Array(total).fill('');
          }
          delayMs = d;
          running = true;
          paused = pausedNow;
          idx = Math.min(opened, urls.length);

          el.toggle.textContent = paused ? TXT[lang].resume : TXT[lang].pause;
          el.note.textContent = paused ? TXT[lang].paused : TXT[lang].running;
          updateBar();
          publishLocalStatus(paused ? TXT[lang].paused : TXT[lang].running);
        }

        if (msg.type === 'seqDone') {
          idx = urls.length;
          stopRun('done');
        }

        if (msg.type === 'seqStopped') {
          stopRun('paused');
        }

        if (msg.type === 'seqError') {
          el.stats.textContent = 'Chyba: ' + (msg.error || 'unknown');
        }
      });
    } catch {}

    updateBar();
    applyLangTexts();
  });
})();
