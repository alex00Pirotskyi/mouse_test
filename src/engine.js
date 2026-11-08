/* Mudra Smart Cursor v1.0 - local-only browser cursor assistance.
 * No network calls, telemetry, or dependency on Mudra-specific APIs.
 * The existing BLE HID pointer is the input device. */
(function () {
  'use strict';
  const KEY = '__MUDRA_SMART_CURSOR_V1__';
  if (window[KEY]) { window[KEY].togglePanel(); return; }
  if (!document.body || !document.documentElement) { alert('Open a normal web page first.'); return; }
  const DEFAULTS = Object.assign({
    radius: 30, releaseRadius: 48, clickRadius: 15, sensitivity: 1,
    fineScale: 0.42, smoothing: 0.78, dwellMs: 950,
    sticky: true, magnetic: true, precision: true, clickAssist: false,
    dwell: false, virtual: false
  }, /*MUDRA_PRESETS*/null || {});
  const STORE_KEY = 'mudra.smartcursor.preferences.v1';
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(STORE_KEY) || '{}') || {}; } catch (_) {}
  const cfg = Object.assign({}, DEFAULTS, saved);
  cfg.virtual = false;
  let dead = false;
  let active = true;
  let minimized = false;
  let virtual = false;
  let locked = false;
  let selecting = null;
  let previousTarget = null;
  let lastRect = null;
  let elements = [];
  let pos = { x: innerWidth / 2, y: innerHeight / 2 };
  let raw = { x: pos.x, y: pos.y };
  let lastMotion = performance.now();
  let dwellTarget = null;
  let dwellAt = 0;
  let dwellFired = false;
  let dwellAnchor = null;
  let scanTimer = 0;
  let raf = 0;
  let timestamp = 0;
  let observer;
  let toastTimer = 0;
  let topEdgeTravel = 0;
  let topEdgeTime = 0;
  let topEdgeRelease = false;

  const host = document.createElement('div');
  host.id = 'mudra-smart-cursor-root';
  host.setAttribute('data-mudra-engine', 'v1');
  host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647;';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>
:host{all:initial;color-scheme:dark;font-family:Inter,ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif;}
*{box-sizing:border-box}
#target{position:fixed;display:none;border:2px solid #66dfff;background:rgba(53,182,226,.09);border-radius:8px;box-shadow:0 0 0 4px rgba(37,197,255,.09);pointer-events:none;transition:transform 45ms linear,width 80ms,height 80ms;}
#pointer{position:fixed;display:none;pointer-events:none;filter:drop-shadow(0 1px 2px #000);width:20px;height:26px;transform:translate(-3px,-1px);}
#pointer svg{width:100%;height:100%}
#ring{position:fixed;width:32px;height:32px;border-radius:50%;display:none;pointer-events:none;background:conic-gradient(#64dffa var(--pct,0%),transparent var(--pct,0%));mask:radial-gradient(farthest-side,transparent calc(100% - 3px),black calc(100% - 2px));-webkit-mask:radial-gradient(farthest-side,transparent calc(100% - 3px),black calc(100% - 2px));}
#panel{position:fixed;right:16px;bottom:16px;width:286px;max-width:calc(100vw - 20px);pointer-events:auto;color:#edf5ff;background:#101b2beF;border:1px solid #3d5770;border-radius:16px;box-shadow:0 18px 50px #0008;backdrop-filter:blur(14px);font-size:12px;line-height:1.45;overflow:hidden;}
header{display:flex;align-items:center;justify-content:space-between;padding:12px 13px;background:#18263b}
.brand{font-size:13px;font-weight:800;letter-spacing:.04em}.sub{font-size:10px;color:#91a9c3;letter-spacing:.08em;text-transform:uppercase}
#panel button{cursor:pointer;color:#eaf4fe;background:#263950;border:1px solid #49617c;border-radius:8px;padding:7px 9px;font:inherit}
#panel button:hover{background:#324e70}#panel button:focus-visible,#panel input:focus-visible{outline:2px solid #60d3ff}
#panel .icon{border:0;background:transparent;font-size:17px;padding:1px 6px;line-height:1}
#controls{padding:12px 13px 13px} .actions{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:11px}.actions button{flex:1;white-space:nowrap}
#panel button.primary{background:#16658e;border-color:#2c9bcb;color:white}
.flags{display:grid;grid-template-columns:1fr 1fr;gap:9px 8px;margin-bottom:12px}
.flags label{display:flex;align-items:center;gap:6px;cursor:pointer;color:#c6d6e7}
#panel input[type=checkbox]{accent-color:#31bde8;cursor:pointer}
.rlabel{display:flex;justify-content:space-between;color:#c3d2e1;margin-top:7px}
#panel input[type=range]{width:100%;accent-color:#3cc7f1;cursor:pointer;margin:5px 0 7px}
.note{font-size:10px;color:#99abc3;line-height:1.5;margin-top:10px}
#status{display:flex;align-items:center;gap:6px;color:#9acbde;font-size:10px}
#dot{height:7px;width:7px;background:#39d69a;border-radius:50%;display:inline-block}
#edgeHint{display:none;position:fixed;top:7px;left:50%;transform:translateX(-50%);padding:7px 13px;background:#10283ceF;color:#c4f4ff;border:1px solid #338bad;border-radius:99px;font-size:11px;white-space:nowrap;pointer-events:none;box-shadow:0 6px 20px #0006}
#toast{display:none;position:fixed;bottom:335px;right:16px;max-width:270px;padding:9px 12px;border-radius:9px;background:#10283c;color:#dff8ff;border:1px solid #338bad;box-shadow:0 8px 25px #0008;font-size:11px;pointer-events:none}
#panel.small{width:auto;min-width:174px}#panel.small #controls{display:none}
@media(max-width:500px){#panel{right:9px;bottom:9px}}
</style>
<div id="target"></div>
<div id="pointer"><svg viewBox="0 0 23 29" xmlns="http://www.w3.org/2000/svg"><path d="M2 1 L2 25 L8.6 19 L13.1 27 L17.1 25 L12.6 17 L21 16 Z" stroke="#10253c" stroke-width="2" fill="#e9f9ff"/></svg></div>
<div id="ring"></div>
<div id="edgeHint">↑ Keep moving up to unlock browser tabs</div>
<div id="toast" role="status"></div>
<div id="panel" role="region" aria-label="Mudra cursor controls">
<header><div><div class="brand">MUDRA <span style="color:#49cee8">CURSOR</span></div><div class="sub">Web precision assist</div></div><div style="display:flex;gap:4px"><button class="icon" id="min" title="Minimize" aria-label="Minimize panel">-</button><button class="icon" id="close" title="Close engine" aria-label="Close engine">×</button></div></header>
<div id="controls">
  <div class="actions"><button id="center">◎ Re-center</button><button id="mode" class="primary">Enable virtual</button></div>
  <div class="flags">
    <label><input type="checkbox" data-flag="magnetic">Magnetic target</label>
    <label><input type="checkbox" data-flag="sticky">Sticky target</label>
    <label><input type="checkbox" data-flag="precision">Fine motion</label>
    <label><input type="checkbox" data-flag="clickAssist">Click assist</label>
    <label><input type="checkbox" data-flag="dwell">Dwell click</label>
    <label><input type="checkbox" id="on" checked>Engine on</label>
  </div>
  <div class="rlabel"><label for="radius">Target radius</label><output id="radiusOut"></output></div><input type="range" id="radius" min="5" max="100" step="1">
  <div class="rlabel"><label for="sensitivity">Virtual sensitivity</label><output id="sensitivityOut"></output></div><input type="range" id="sensitivity" min="0.4" max="2.4" step="0.1">
  <div class="rlabel"><label for="dwellMs">Dwell time</label><output id="dwellOut"></output></div><input type="range" id="dwellMs" min="600" max="2000" step="50">
  <div id="status"><span id="dot"></span><span id="statusText">Normal HID mode</span></div>
  <div class="note">Alt+Shift+C: re-center · Alt+Shift+P: virtual mode · Alt+Shift+M: panel · Push above the top edge or press Esc to unlock browser tabs. Browser may reject pointer lock. Assisted clicks and dwell are optional because they can activate website actions.</div>
</div></div>`;
  document.documentElement.appendChild(host);
  const $ = id => root.getElementById(id);
  const targetVisual = $('target');
  const pointerVisual = $('pointer');
  const ring = $('ring');
  const edgeHint = $('edgeHint');
  const panel = $('panel');
  const interactive = 'a[href],button,input:not([type="hidden"]),select,textarea,summary,[role="button"],[role="link"],[role="checkbox"],[tabindex]:not([tabindex="-1"])';

  function persist() {
    const out = Object.assign({}, cfg); delete out.virtual;
    try { localStorage.setItem(STORE_KEY, JSON.stringify(out)); } catch (_) {}
  }
  function note(s) {
    $('toast').textContent = s; $('toast').style.display = 'block';
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').style.display = 'none'; }, 3000);
  }
  function panelUpdate() {
    root.querySelectorAll('[data-flag]').forEach(c => { c.checked = !!cfg[c.dataset.flag]; });
    $('on').checked = active;
    $('radius').value = cfg.radius; $('radiusOut').textContent = cfg.radius + ' px';
    $('sensitivity').value = cfg.sensitivity; $('sensitivityOut').textContent = Number(cfg.sensitivity).toFixed(1) + '×';
    $('dwellMs').value = cfg.dwellMs; $('dwellOut').textContent = cfg.dwellMs + ' ms';
    $('mode').textContent = virtual ? 'Exit virtual' : 'Enable virtual';
    $('statusText').textContent = locked ? 'Virtual cursor (Pointer Lock)' : 'Normal HID cursor';
    $('dot').style.background = active ? '#39d69a' : '#e6a953';
    panel.classList.toggle('small', minimized);
    $('min').textContent = minimized ? '+' : '-';
  }
  function isInternal(el) { return el === host || host.contains(el) || (el && el.getRootNode && el.getRootNode() === root); }
  function allowed(el) {
    if (!el || !el.isConnected || isInternal(el)) return false;
    if (el.matches(':disabled,[aria-disabled="true"],[inert]')) return false;
    if (el.closest('[inert],[aria-hidden="true"]')) return false;
    const st = getComputedStyle(el);
    if (st.display === 'none' || st.visibility !== 'visible' || st.pointerEvents === 'none') return false;
    const b = el.getBoundingClientRect();
    return b.width >= 5 && b.height >= 5 && b.right > 0 && b.bottom > 0 && b.left < innerWidth && b.top < innerHeight;
  }
  function scan() {
    if (dead) return;
    elements = Array.from(document.querySelectorAll(interactive)).slice(0, 1600).filter(allowed);
    render();
  }
  function scheduleScan() {
    if (scanTimer || dead) return;
    scanTimer = setTimeout(() => { scanTimer = 0; scan(); }, 220);
  }
  function rectDistance(r, x, y) {
    const dx = Math.max(r.left - x, 0, x - r.right);
    const dy = Math.max(r.top - y, 0, y - r.bottom);
    return Math.hypot(dx, dy);
  }
  function nearest(x, y) {
    if (!active || !cfg.magnetic) return null;
    let best = null, distance = cfg.radius + .001;
    if (cfg.sticky && selecting && allowed(selecting)) {
      const sd = rectDistance(selecting.getBoundingClientRect(), x, y);
      if (sd <= Math.max(cfg.releaseRadius, cfg.radius + 12)) return selecting;
    }
    for (let i = 0; i < elements.length; i++) {
      const el = elements[i];
      if (!el.isConnected) continue;
      const r = el.getBoundingClientRect();
      const d = rectDistance(r, x, y);
      if (d < distance) { best = el; distance = d; }
    }
    return best;
  }
  function isEditable(el) { return !!(el && (el.closest('input,textarea,select,[contenteditable="true"]'))); }
  function unsafeClick(el) {
    if (!el || !allowed(el)) return true;
    const tag = el.tagName.toLowerCase();
    if (tag === 'input' && ['submit','reset','file','password'].includes(el.type)) return true;
    if (tag === 'button' && (el.type === 'submit' || el.type === 'reset')) return true;
    if (tag === 'a' && (/^javascript:/i.test(el.getAttribute('href') || '') || el.hasAttribute('download'))) return true;
    if (el.closest('[contenteditable="true"]')) return true;
    // Conservative safeguard: do not auto-fire irreversible-looking actions.
    const label = ((el.innerText || el.value || el.getAttribute('aria-label') || '') + '').slice(0, 100);
    if (/\b(delete|remove|purchase|checkout|pay|transfer|confirm order|submit|unsubscribe|sign out|log out)\b/i.test(label)) return true;
    return false;
  }
  function activate(el, via) {
    if (!el || unsafeClick(el)) { if (el) note('Protected control: use a normal click.'); return false; }
    if (el.matches('input[type="text"],input[type="email"],input[type="number"],input[type="search"],input[type="tel"],input[type="url"],textarea,select')) {
      el.focus({ preventScroll: true });
    } else {
      el.click(); // Programmatic activation: may be ignored by sites requiring trusted events.
    }
    if (via === 'dwell') note('Dwell activated an element');
    return true;
  }
  function resetDwell() { dwellTarget = null; dwellAt = 0; dwellFired = false; dwellAnchor = null; ring.style.display = 'none'; }
  function scheduleDraw() { if (!raf && !dead) raf = requestAnimationFrame(() => { raf = 0; render(); }); }
  function render() {
    if (dead) return;
    if (!active) { targetVisual.style.display = 'none'; pointerVisual.style.display = 'none'; edgeHint.style.display = 'none'; resetDwell(); return; }
    edgeHint.style.display = locked && raw.y <= 14 ? 'block' : 'none';
    if (virtual) {
      pointerVisual.style.display = 'block';
      pointerVisual.style.left = pos.x + 'px'; pointerVisual.style.top = pos.y + 'px';
    } else { pointerVisual.style.display = 'none'; }
    selecting = nearest(pos.x, pos.y);
    if (selecting) {
      const b = selecting.getBoundingClientRect();
      targetVisual.style.display = 'block';
      targetVisual.style.left = Math.max(0, b.left - 4) + 'px'; targetVisual.style.top = Math.max(0, b.top - 4) + 'px';
      targetVisual.style.width = b.width + 8 + 'px'; targetVisual.style.height = b.height + 8 + 'px';
      lastRect = b;
    } else { targetVisual.style.display = 'none'; lastRect = null; }
    if (cfg.dwell && selecting && !unsafeClick(selecting)) {
      if (dwellTarget !== selecting) { dwellTarget = selecting; dwellAt = performance.now(); dwellFired = false; dwellAnchor = {x:pos.x,y:pos.y}; }
      if (dwellAnchor && Math.hypot(pos.x - dwellAnchor.x,pos.y - dwellAnchor.y) > 9) { dwellAt = performance.now(); dwellAnchor = {x:pos.x,y:pos.y}; }
      if (!dwellFired) {
        const pct = Math.min(100, 100 * (performance.now() - dwellAt) / cfg.dwellMs);
        ring.style.cssText = `display:block;left:${pos.x - 16}px;top:${pos.y - 16}px;--pct:${pct}%;`;
        if (pct >= 100) { dwellFired = true; ring.style.display = 'none'; activate(selecting, 'dwell'); }
      }
    } else resetDwell();
  }
  function onMove(ev) {
    if (!active || dead) return;
    if (locked) {
      if (ev.type !== 'mousemove') return;
      const near = selecting && lastRect && rectDistance(lastRect, pos.x, pos.y) <= cfg.radius;
      const scale = cfg.sensitivity * (near && cfg.precision ? cfg.fineScale : 1);
      raw.x = Math.max(2, Math.min(innerWidth - 2, raw.x + (ev.movementX || 0) * scale));
      raw.y = Math.max(2, Math.min(innerHeight - 2, raw.y + (ev.movementY || 0) * scale));
      // Pointer Lock cannot enter Chrome's tab strip. Deliberately pushing
      // upward beyond the page edge releases the *real* HID cursor.
      // A 48px overshoot prevents accidental unlock on ordinary top-row clicks.
      const dy = ev.movementY || 0;
      const now = performance.now();
      if (raw.y <= 8 && dy < 0) {
        if (now - topEdgeTime > 900) topEdgeTravel = 0;
        topEdgeTime = now;
        topEdgeTravel += -dy;
        if (topEdgeTravel >= 48) {
          topEdgeTravel = 0;
          topEdgeRelease = true;
          document.exitPointerLock();
          return;
        }
      } else if (raw.y > 30 || dy > 4) topEdgeTravel = 0;
      const alpha = Math.max(0.05, Math.min(1, cfg.smoothing));
      pos.x += (raw.x - pos.x) * alpha;
      pos.y += (raw.y - pos.y) * alpha;
    } else {
      if (ev.type === 'pointermove' && ev.pointerType !== 'mouse') return;
      if (ev.type === 'mousemove' && 'onpointermove' in window) return;
      if (isInternal(ev.target)) return;
      pos.x = ev.clientX; pos.y = ev.clientY; raw.x = pos.x; raw.y = pos.y;
    }
    lastMotion = performance.now();
    scheduleDraw();
  }
  function onClick(ev) {
    if (!active || !ev.isTrusted || ev.button !== 0 || dead) return;
    if (isInternal(ev.target) && !locked) return;
    if (locked) {
      ev.preventDefault(); ev.stopImmediatePropagation();
      // Pointer Lock delivers real clicks to the lock element rather than the
      // visual position. Re-route only our own shadow-panel buttons/checkboxes.
      const ownElement = typeof root.elementFromPoint === 'function'
        ? root.elementFromPoint(pos.x, pos.y) : null;
      if (ownElement && panel.contains(ownElement)) {
        const button = ownElement.closest('button');
        const checkbox = ownElement.closest('input[type="checkbox"]');
        if (button) button.click();
        else if (checkbox) checkbox.click();
        return;
      }
      if (selecting) activate(selecting, 'virtual');
      return;
    }
    if (!cfg.clickAssist || isEditable(ev.target) || ev.target.closest(interactive)) return;
    const candidate = selecting;
    if (!candidate || rectDistance(candidate.getBoundingClientRect(), ev.clientX, ev.clientY) > cfg.clickRadius) return;
    if (window.getSelection && !window.getSelection().isCollapsed) return;
    if (unsafeClick(candidate)) return;
    ev.preventDefault(); ev.stopImmediatePropagation();
    activate(candidate, 'assist');
  }
  function onMouseDown(ev) {
    if (locked && active && ev.isTrusted && ev.button === 0) { ev.preventDefault(); ev.stopImmediatePropagation(); }
  }
  function onScroll() { scheduleDraw(); scheduleScan(); }
  function recenter() {
    pos.x = raw.x = innerWidth / 2; pos.y = raw.y = innerHeight / 2;
    selecting = null; resetDwell(); scheduleDraw();
    if (!virtual) note('Normal mode cannot move the system cursor. Enable virtual cursor to re-center.');
    else note('Virtual cursor re-centered');
  }
  function requestVirtual() {
    if (locked) { document.exitPointerLock(); return; }
    if (!active) { note('Enable the engine first.'); return; }
    if (!document.documentElement.requestPointerLock) { note('Pointer Lock is not supported here.'); return; }
    try {
      const result = document.documentElement.requestPointerLock();
      if (result && result.catch) result.catch(() => note('Pointer Lock denied. Try another site or use normal mode.'));
    } catch (_) { note('Pointer Lock denied by browser or site.'); }
  }
  function onLockChange() {
    const wasLocked = locked;
    locked = document.pointerLockElement === document.documentElement;
    virtual = locked;
    topEdgeTravel = 0;
    if (locked) {
      pos.x = raw.x = innerWidth / 2; pos.y = raw.y = innerHeight / 2;
      note('Virtual cursor enabled. Push past top edge for tabs, or press Esc.');
    } else {
      resetDwell();
      if (wasLocked && topEdgeRelease) {
        note('Browser navigation unlocked. Move the HID cursor to Chrome tabs. Re-enable virtual to return.');
      }
    }
    topEdgeRelease = false;
    panelUpdate(); render();
  }
  function onLockError() { note('Pointer Lock unavailable on this page.'); }
  function onKey(ev) {
    if (dead || !ev.altKey || !ev.shiftKey || ev.ctrlKey || ev.metaKey) return;
    const key = ev.key.toLowerCase();
    if (!['m', 'c', 'p', 'd'].includes(key)) return;
    ev.preventDefault(); ev.stopImmediatePropagation();
    if (key === 'm') { minimized = !minimized; panelUpdate(); }
    if (key === 'c') recenter();
    if (key === 'p') requestVirtual();
    if (key === 'd') { cfg.dwell = !cfg.dwell; persist(); panelUpdate(); resetDwell(); }
  }
  function togglePanel() { minimized = !minimized; panelUpdate(); }
  function stop() {
    if (dead) return;
    dead = true;
    if (locked && document.exitPointerLock) document.exitPointerLock();
    document.removeEventListener('pointermove', onMove, true);
    document.removeEventListener('mousemove', onMove, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('mousedown', onMouseDown, true);
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('pointerlockchange', onLockChange);
    document.removeEventListener('pointerlockerror', onLockError);
    window.removeEventListener('scroll', onScroll, true);
    window.removeEventListener('resize', onScroll);
    if (observer) observer.disconnect();
    cancelAnimationFrame(raf); clearTimeout(scanTimer); clearTimeout(toastTimer); clearInterval(ticker);
    host.remove(); if (window[KEY] && window[KEY].stop === stop) delete window[KEY];
  }
  $('close').addEventListener('click', stop);
  $('min').addEventListener('click', togglePanel);
  $('center').addEventListener('click', recenter);
  $('mode').addEventListener('click', requestVirtual);
  $('on').addEventListener('change', e => { active = e.target.checked; if (!active && locked) document.exitPointerLock(); panelUpdate(); render(); });
  root.querySelectorAll('[data-flag]').forEach(input => input.addEventListener('change', e => { cfg[e.target.dataset.flag] = e.target.checked; persist(); resetDwell(); render(); }));
  for (const [id, key, output, fmt] of [['radius','radius','radiusOut',v=>v+' px'], ['sensitivity','sensitivity','sensitivityOut',v=>Number(v).toFixed(1)+'×'], ['dwellMs','dwellMs','dwellOut',v=>v+' ms']]) {
    $(id).addEventListener('input', e => { cfg[key] = Number(e.target.value); if (key === 'radius') cfg.releaseRadius = Math.max(cfg.radius + 12, cfg.releaseRadius); $(output).textContent = fmt(cfg[key]); persist(); scheduleDraw(); });
  }
  document.addEventListener('pointermove', onMove, true);
  document.addEventListener('mousemove', onMove, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('mousedown', onMouseDown, true);
  document.addEventListener('keydown', onKey, true);
  document.addEventListener('pointerlockchange', onLockChange);
  document.addEventListener('pointerlockerror', onLockError);
  window.addEventListener('scroll', onScroll, true);
  window.addEventListener('resize', onScroll);
  if (window.MutationObserver) {
    observer = new MutationObserver(mutations => {
      if (mutations.every(m => isInternal(m.target))) return;
      scheduleScan();
    });
    observer.observe(document.documentElement, {childList:true,subtree:true,attributes:true,attributeFilter:['style','class','aria-hidden','disabled']});
  }
  const ticker = setInterval(() => { if (!dead && active && cfg.dwell) render(); }, 45);
  window[KEY] = {stop, togglePanel, recenter, getState: () => ({cfg:Object.assign({},cfg),virtual,locked,active})};
  panelUpdate(); scan(); note('Mudra Smart Cursor active');
})();
