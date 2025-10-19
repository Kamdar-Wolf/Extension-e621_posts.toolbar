(async function () {
  const el = (id)=>document.getElementById(id);
  const $total=el('total'), $opened=el('opened'), $converted=el('converted'), $inflight=el('inflight'), $bar=el('bar'), $status=el('status');

  // === zdroj URL: příklad – vezmeme je z active tab přes content skript (= musíš mít svůj content, co je vrátí)
  async function collectUrlsFromActiveTab() {
    const [tab] = await chrome.tabs.query({active:true,currentWindow:true});
    if (!tab?.id) return [];
    // očekává se, že content skript na zprávu 'collectUrls' vrátí {urls:[...]}
    try {
      const resp = await chrome.tabs.sendMessage(tab.id, { type: "collectUrls" });
      return Array.isArray(resp?.urls) ? resp.urls : [];
    } catch {
      // fallback: nic nenašlo
      return [];
    }
  }

  function updateBar(total, converted){
    const pct = (!total || total<=0) ? 0 : Math.min(100, Math.round((converted/total)*100));
    $bar.style.width = pct + '%';
  }

  // progress z backgroundu
  chrome.runtime.onMessage.addListener((msg, sender) => {
    if (msg?.type === 'burstProgress') {
      $total.textContent = String(msg.total ?? 0);
      $opened.textContent = String(msg.opened ?? 0);
      $converted.textContent = String(msg.converted ?? 0);
      $inflight.textContent = String(msg.inFlight ?? 0);
      updateBar(msg.total, msg.converted);
      $status.textContent = `Běží… dávka=${el('batchSize').value}, interval=${el('batchInterval').value}ms, krok=${el('stepMs').value}ms`;
    }
    if (msg?.type === 'burstDone') {
      $status.textContent = 'Hotovo.';
    }
  });

  el('start').addEventListener('click', async () => {
    $status.textContent = 'Připravuji…';
    let urls = await collectUrlsFromActiveTab();

    // Máš-li v UI vlastní sběr URL (např. z rozhraní stránky), klidně tenhle sběr přepiš.
    if (!urls || urls.length===0) {
      $status.textContent = 'Nenašel jsem žádné URL.';
      return;
    }

    const batchSize = Number(el('batchSize').value || 5);
    const batchIntervalMs = Number(el('batchInterval').value || 3000);
    const stepMs = Number(el('stepMs').value || 1500);

    // reset lokálního zobrazení
    $total.textContent = String(urls.length);
    $opened.textContent = '0';
    $converted.textContent = '0';
    $inflight.textContent = '0';
    updateBar(urls.length, 0);

    chrome.runtime.sendMessage({
      type: 'burstOpen',
      urls,
      batchSize,
      batchIntervalMs,
      stepMs
    }, (resp) => {
      if (!resp?.ok) {
        $status.textContent = 'Chyba: ' + (resp?.error || 'neznámá');
        return;
      }
      $status.textContent = `Běží… (${resp.enqueued} URL)`;
    });
  });

  el('stop').addEventListener('click', () => {
    // jednoduché "stop" = nic dalšího neodesílat; pokročilé stop by vyžadovalo držet id alarmů a rušit
    $status.textContent = 'Zastaveno (nové dávky se neodešlou).';
  });
})();
