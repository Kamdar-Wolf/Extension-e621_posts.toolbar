(() => {
  const qs = (s) => document.querySelector(s);

  const $size = qs('#kd-batchSize');
  const $intv = qs('#kd-batchIntervalMs');
  const $step = qs('#kd-stepMs');
  const $bar  = qs('#kd-bar');
  const $stat = qs('#kd-status');
  const $start= qs('#kd-start');
  const $stop = qs('#kd-stop');
  const $save = qs('#kd-settings');

  // --- pomocné ---
  function clamp(n, lo, hi){ n=Number(n); return isFinite(n)?Math.max(lo,Math.min(hi,n)):lo; }
  const fmt = (n)=> String(n|0);

  // --- inicializace: načti config z backgroundu ---
  chrome.runtime.sendMessage({type:'getBurstConfig'}, (res)=>{
    if(!res?.ok) return;
    const {size, intervalMs, stepMs} = res.config || {};
    if (size != null) $size.value = fmt(size);
    if (intervalMs != null) $intv.value = fmt(intervalMs);
    if (stepMs != null) $step.value = fmt(stepMs);
  });

  // --- uložit config do storage (trvalé) ---
  $save?.addEventListener('click', ()=>{
    const size = clamp($size.value, 1, 50);
    const intervalMs = Math.max(500, Number($intv.value||0));
    const stepMs = Math.max(200, Number($step.value||0));
    chrome.runtime.sendMessage({type:'setBurstConfig', size, intervalMs, stepMs}, (res)=>{
      if(res?.ok){
        $stat.textContent = 'Nastavení uloženo.';
      }else{
        $stat.textContent = 'Chyba ukládání.';
      }
    });
  });

  // --- progress listener (background nám postílá průběh) ---
  chrome.runtime.onMessage.addListener((msg)=>{
    if(!msg || !msg.type) return;
    if(msg.type === 'burstProgress'){
      const {total, created, opened} = msg;
      const pct = total>0 ? Math.round((opened/total)*100) : 0;
      $bar.style.width = `${pct}%`;
      $stat.textContent = `Placeholdery: ${created}/${total} • Otevřeno: ${opened}/${total}`;
    }
    if(msg.type === 'burstDone'){
      const {total} = msg;
      $bar.style.width = '100%';
      $stat.textContent = `Hotovo. Otevřeno: ${total}/${total}`;
    }
  });

  // --- Start: seber URL ze stránky (nebo vlastní zdroj, dle tvého skriptu) ---
  async function collectUrls() {
    // Sem dosaď svoji logiku sběru odkazů.
    // Jako fallback: vezmeme všechny <a href="/posts/...">
    const anchors = Array.from(document.querySelectorAll('a[href^="/posts"]'));
    const urls = anchors.map(a => a.href).filter(Boolean);
    // Limit 250 bude ošetřen v backgroundu; tady nechávám plný seznam
    return Array.from(new Set(urls));
  }

  $start?.addEventListener('click', async ()=>{
    const urls = await collectUrls();
    if(!urls.length){ $stat.textContent = 'Nenalezeny žádné odkazy.'; return; }

    // Jednorázové hodnoty (nepřepisují storage, pouze tento běh)
    const batchSize = clamp($size.value, 1, 50);
    const batchIntervalMs = Math.max(500, Number($intv.value||0));
    const stepMs = Math.max(200, Number($step.value||0));

    $bar.style.width = '0%';
    $stat.textContent = `Startuji... (n=${urls.length})`;

    chrome.runtime.sendMessage({
      type:'burstOpen',
      urls,
      batchSize,
      batchIntervalMs,
      stepMs
    }, (res)=>{
      if(!res?.ok){
        $stat.textContent = `Chyba startu: ${res?.error||'unknown'}`;
      }else{
        $stat.textContent = `Ve frontě: ${res.enqueued} (dávka ${res.batchSize} / ${res.batchIntervalMs} ms; odstup ${res.stepMs} ms)`;
      }
    });
  });

  // --- Stop: pošli pokyn backgroundu, aby zrušil intervaly a alarmy a uklidil placeholdery ---
  $stop?.addEventListener('click', ()=>{
    chrome.runtime.sendMessage({type:'burstStop'}, (res)=>{
      if(res?.ok){
        $stat.textContent = 'Zastaveno.';
      }else{
        $stat.textContent = `Stop: ${res?.error||'neznámá chyba'}`;
      }
    });
  });
})();
