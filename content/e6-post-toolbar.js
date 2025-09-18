(function(){
  'use strict';
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