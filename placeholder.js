(function(){
  'use strict';
  const qs = new URLSearchParams(location.search);
  const rawUrl = qs.get('u') || '';
  const delay  = Math.max(0, parseInt(qs.get('d')||'0',10) || 0);
  const i      = Math.max(1, parseInt(qs.get('i')||'1',10) || 1);
  const n      = Math.max(i, parseInt(qs.get('n')||String(i),10) || i);

  let target = null;
  try { const u = new URL(rawUrl); if (u.protocol === 'http:' || u.protocol === 'https:') target = u.href; } catch {}
  if (!target) {
    document.title = "[invalid] " + i + "/" + n;
    document.getElementById('title').textContent = "Invalid target URL";
    document.getElementById('count').textContent = "0";
    document.getElementById('idx').textContent = String(i);
    document.getElementById('total').textContent = String(n);
    return;
  }

  const link = document.getElementById('link');
  link.href = target;

  const idx  = document.getElementById('idx');
  const tot  = document.getElementById('total');
  const cnt  = document.getElementById('count');
  const ttl  = () => `[${remaining}s] ${i}/${n}`;

  idx.textContent = String(i);
  tot.textContent = String(n);

  let remaining = Math.ceil(delay/1000);
  cnt.textContent = String(remaining);
  document.title = ttl();

  function go() { location.replace(target); }

  let timer = null;
  if (remaining <= 0) go();
  else {
    timer = setInterval(() => {
      remaining -= 1;
      cnt.textContent = String(Math.max(0, remaining));
      document.title = ttl();
      if (remaining <= 0) { clearInterval(timer); go(); }
    }, 1000);
  }

  document.addEventListener('click', go, { once:true });
  document.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); }, { once:true });
})();
