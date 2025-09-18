(async function(){
  const [curTab] = await chrome.tabs.query({ active:true, currentWindow:true });
  const url = curTab?.url || '';
  const isHttp = /^https?:\/\//i.test(url);
  const origin = isHttp ? (new URL(url)).origin : '';

  const curOriginEl = document.getElementById('curOrigin');
  const statusEl    = document.getElementById('status');
  const toggleBtn   = document.getElementById('toggle');
  const injectBtn   = document.getElementById('inject');
  const msgEl       = document.getElementById('msg');

  curOriginEl.textContent = isHttp ? origin : '(unsupported page)';

  const say = (txt, ok) => {
    msgEl.textContent = txt || '';
    msgEl.className = 'note ' + (ok===true ? 'ok' : ok===false ? 'err' : '');
  };

  if (!isHttp) {
    statusEl.textContent = 'N/A';
    toggleBtn.disabled = true;
    injectBtn.disabled = true;
    say('Works only on http/https pages.', false);
    return;
  }

  const { autoSites } = await chrome.storage.local.get('autoSites');
  let enabled = Array.isArray(autoSites) && autoSites.includes(origin);
  const updateUI = () => {
    statusEl.textContent = enabled ? 'ENABLED' : 'DISABLED';
    toggleBtn.textContent = enabled ? 'Disable' : 'Enable';
    toggleBtn.className = enabled ? 'destructive' : '';
  };
  updateUI();

  injectBtn.addEventListener('click', async () => {
    say('');
    const res = await chrome.runtime.sendMessage({ type:'INJECT_NOW', tabId: curTab.id })
      .catch(e => ({ ok:false, error:String(e)}));
    say(res?.ok ? 'Injected.' : ('Failed: ' + (res?.error||'unknown')), !!res?.ok);
  });

  toggleBtn.addEventListener('click', async () => {
    say('');
    if (!enabled) {
      const res = await chrome.runtime.sendMessage({ type:'ENABLE_AUTO_FOR_ORIGIN', origin })
        .catch(e => ({ ok:false, error:String(e) }));
      if (res?.ok) { enabled = true; updateUI(); say('Auto enabled for this site.', true); }
      else say('Permission/enable failed: ' + (res?.error || 'unknown'), false);
    } else {
      const res = await chrome.runtime.sendMessage({ type:'DISABLE_AUTO_FOR_ORIGIN', origin })
        .catch(e => ({ ok:false, error:String(e) }));
      if (res?.ok) { enabled = false; updateUI(); say('Auto disabled for this site.', true); }
      else say('Disable failed: ' + (res?.error || 'unknown'), false);
    }
  });
})();
