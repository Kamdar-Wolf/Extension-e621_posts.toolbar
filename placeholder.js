(function(){
  'use strict';

  // --- i18n map ---
  const I18N = {
    cs: {
      preparing: 'Připravuji…',
      invalid: 'Neplatný cílový odkaz',
      hint: 'Klikni pro okamžité otevření, nebo stiskni <span class="kbd">Enter</span>.',
      openNow: 'Otevřít hned',
      secUnit: 's',
      titleLoading: (s,i,n) => `Připravuji… ${s}${I18N.cs.secUnit} (${i}/${n})`,
      titleInvalid: (i,n) => `[neplatné] ${i}/${n}`
    },
    en: {
      preparing: 'Preparing…',
      invalid: 'Invalid target URL',
      hint: 'Click anywhere to open immediately, or press <span class="kbd">Enter</span>.',
      openNow: 'Open now',
      secUnit: 's',
      titleLoading: (s,i,n) => `Loading… ${s}${I18N.en.secUnit} (${i}/${n})`,
      titleInvalid: (i,n) => `[invalid] ${i}/${n}`
    }
  };

  const LANG_KEY = 'kd_lang';
  let lang = 'cs'; // výchozí; hned po startu přepíšeme z storage

  const qs    = new URLSearchParams(location.search);
  const rawUrl= qs.get('u') || '';
  const delay = Math.max(0, parseInt(qs.get('d')||'0',10) || 0);
  const i     = Math.max(1, parseInt(qs.get('i')||'1',10) || 1);
  const n     = Math.max(i, parseInt(qs.get('n')||String(i),10) || i);

  const $ = (id) => document.getElementById(id);
  const el = {
    title: $('title'),
    count: $('count'),
    idx:   $('idx'),
    total: $('total'),
    hint:  $('hint'),
    link:  $('link'),
    sec:   $('secUnit')
  };

  function setHtmlLang() {
    document.documentElement.setAttribute('lang', lang);
  }

  function applyTextsInitial() {
    const T = I18N[lang];
    document.title = T.titleLoading(el.count.textContent || '0', i, n);
    $('title').textContent = T.preparing;
    el.hint.innerHTML = T.hint;
    el.link.textContent = T.openNow;
    el.sec.textContent = T.secUnit;
  }

  function applyInvalidTexts() {
    const T = I18N[lang];
    document.title = T.titleInvalid(i, n);
    $('title').textContent = T.invalid;
    el.hint.innerHTML = T.hint;
    el.link.textContent = T.openNow;
    el.sec.textContent = T.secUnit;
  }

  function ttl(remaining) {
    return I18N[lang].titleLoading(String(Math.max(0, remaining)), i, n);
  }

  function readLangFromStorage(cb){
    try {
      chrome.storage.local.get(LANG_KEY, (items) => {
        const v = items && items[LANG_KEY];
        lang = (v === 'en') ? 'en' : 'cs';
        setHtmlLang();
        cb();
      });
    } catch {
      lang = 'cs';
      setHtmlLang();
      cb();
    }
  }

  // reaguj i na živé přepnutí v HUD
  try {
    chrome.storage.onChanged.addListener((ch, area) => {
      if (area !== 'local' || !ch[LANG_KEY]) return;
      lang = (ch[LANG_KEY].newValue === 'en') ? 'en' : 'cs';
      setHtmlLang();
      // překresli texty při změně
      applyTextsInitial();
      // a zároveň update titulku (pokud běží odpočet)
      const remaining = parseInt(el.count?.textContent || '0', 10) || 0;
      document.title = ttl(remaining);
    });
  } catch {}

  // --- hlavní logika ---
  let target = null;
  try { const u = new URL(rawUrl); if (u.protocol === 'http:' || u.protocol === 'https:') target = u.href; } catch {}

  readLangFromStorage(() => {
    el.idx.textContent   = String(i);
    el.total.textContent = String(n);

    if (!target) {
      el.count.textContent = '0';
      applyInvalidTexts();
      return;
    }

    // výchozí texty po načtení jazyka
    applyTextsInitial();

    let remaining = Math.ceil(delay / 1000);
    el.count.textContent = String(Math.max(0, remaining));

    const go = () => {
      try { window.location.replace(target); }
      catch { try { window.open(target, '_self'); } catch {}
      }
    };

    let timer = null;
    if (remaining <= 0) {
      go();
    } else {
      document.title = ttl(remaining);
      timer = setInterval(() => {
        remaining -= 1;
        el.count.textContent = String(Math.max(0, remaining));
        document.title = ttl(remaining);
        if (remaining <= 0) { clearInterval(timer); go(); }
      }, 1000);
    }

    document.addEventListener('click', go, { once:true });
    document.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); }, { once:true });

    // „Otevřít hned“
    el.link.addEventListener('click', (e) => { e.preventDefault(); go(); });
  });
})();
