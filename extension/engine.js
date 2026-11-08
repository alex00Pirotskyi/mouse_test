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
  // Air Touch firmware state, not cursor boundary motion, owns virtual mode.
  let bleDevice = null;
  let bleCmd = null;
  let bleBattery = null;
  let bleBusy = false;
  let bleWriting = false;
  let bleConnected = false;
  let batteryLevel = null;
  let airTouch = null;
  let mapAt = 0;
  let lastError = '';
  let pollTimer = 0;
  let batteryTimer = 0;
  let shakeTrail = [];
  let shakeLast = 0;
  let shakeTimer = 0;

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
#pointer.shaking{animation:mudra-shake 600ms ease-out forwards;transform-origin:3px 2px}
@keyframes mudra-shake{0%{transform:translate(-3px,-1px) scale(1)}35%{transform:translate(-3px,-1px) scale(2.9)}70%{transform:translate(-3px,-1px) scale(2.5)}100%{transform:translate(-3px,-1px) scale(1)}}
#ble-card{display:flex;flex-direction:column;gap:6px;padding:10px 10px 12px;margin-bottom:11px;background:#0b2434;border-radius:10px;border:1px solid #30566b}
#ble-card .ble-line{display:flex;justify-content:space-between;gap:6px;align-items:center}
#ble-card strong{color:#d8f8ff;font-size:11px;font-weight:700}
#ble-card button{padding:6px 8px !important}
#toast{display:none;position:fixed;bottom:335px;right:16px;max-width:270px;padding:9px 12px;border-radius:9px;background:#10283c;color:#dff8ff;border:1px solid #338bad;box-shadow:0 8px 25px #0008;font-size:11px;pointer-events:none}
#panel.small{width:auto;min-width:174px}#panel.small #controls{display:none}
@media(max-width:500px){#panel{right:9px;bottom:9px}}
</style>
<div id="target"></div>
<div id="pointer"><svg viewBox="0 0 23 29" xmlns="http://www.w3.org/2000/svg"><path d="M2 1 L2 25 L8.6 19 L13.1 27 L17.1 25 L12.6 17 L21 16 Z" stroke="#10253c" stroke-width="2" fill="#e9f9ff"/></svg></div>
<div id="ring"></div>
<div id="toast" role="status"></div>
<div id="panel" role="region" aria-label="Mudra cursor controls">
<header><div><div class="brand">MUDRA <span style="color:#49cee8">CURSOR</span></div><div class="sub">Web precision assist</div></div><div style="display:flex;gap:4px"><button class="icon" id="min" title="Minimize" aria-label="Minimize panel">-</button><button class="icon" id="close" title="Close engine" aria-label="Close engine">×</button></div></header>
<div id="controls">
  <div id="ble-card">
    <div class="ble-line"><strong id="bleState">Mudra: Not connected</strong><button id="bleConnect">Connect Mudra</button></div>
    <div class="ble-line"><span id="bleAir">Air Touch: unknown</span><span id="bleBattery">Battery: —</span></div>
    <div id="bleDetail" style="color:#8eafc4;font-size:10px">Read-only system map monitoring</div>
  </div>
  <div class="actions"><button id="center">◎ Re-center</button><button id="mode" class="primary">Waiting for Air Touch</button></div>
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
  <div class="note">Connect Mudra to monitor Air Touch. Air Touch OFF → normal HID; ON → virtual can be activated by clicking. Shake the virtual pointer to enlarge and re-center. Esc unlocks browser tabs; turning Air Touch OFF also unlocks. Browser may require a click to re-enter virtual. Assisted clicks and dwell are optional because they can activate website actions.</div>
</div></div>`;
  document.documentElement.appendChild(host);
  const $ = id => root.getElementById(id);
  const targetVisual = $('target');
  const pointerVisual = $('pointer');
  const ring = $('ring');
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
    $('mode').textContent = locked ? 'Exit virtual' : airTouch === true && bleConnected ? 'Enter virtual' : 'Waiting for Air Touch';
    $('mode').disabled = !locked && !(bleConnected && airTouch === true);
    $('bleState').textContent = bleBusy ? 'Mudra: Connecting…' : bleConnected ? 'Mudra: Connected' : 'Mudra: Not connected';
    $('bleConnect').textContent = bleConnected ? 'Disconnect' : 'Connect Mudra';
    $('bleConnect').disabled = bleBusy;
    $('bleAir').textContent = 'Air Touch: ' + (airTouch === null ? 'unknown' : airTouch ? 'ON' : 'OFF');
    $('bleBattery').textContent = 'Battery: ' + (batteryLevel === null ? '—' : batteryLevel + '%');
    $('bleDetail').textContent = lastError || (!bleConnected ? 'Read-only system map monitoring' : airTouch === null ? 'Waiting for firmware system map…' : airTouch && !locked ? 'Air Touch ON — click Enter virtual' : airTouch ? 'Virtual active' : 'Air Touch OFF — normal HID active');
    $('statusText').textContent = locked ? 'Virtual (firmware Air Touch ON)' : bleConnected && airTouch ? 'Air Touch ON — click Enter virtual' : 'Normal HID cursor';
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
    if (!active) { targetVisual.style.display = 'none'; pointerVisual.style.display = 'none'; resetDwell(); return; }
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
      checkShake(ev.movementX || 0, ev.movementY || 0);
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
  function recenter(animated = false) {
    if (!locked) { note('Re-center only works in virtual mode.'); return; }
    pos.x = raw.x = innerWidth / 2; pos.y = raw.y = innerHeight / 2;
    selecting = null; resetDwell(); scheduleDraw();
    if (animated) {
      clearTimeout(shakeTimer);
      pointerVisual.classList.remove('shaking');
      void pointerVisual.offsetWidth;
      pointerVisual.classList.add('shaking');
      shakeTimer = setTimeout(() => pointerVisual.classList.remove('shaking'), 630);
    } else note('Virtual cursor re-centered');
  }
  function checkShake(dx,dy) {
    if (!locked || !active) return;
    const now = performance.now();
    if (now - shakeLast < 1300) return;
    const magnitude = Math.hypot(dx,dy);
    if (magnitude < 6) return;
    shakeTrail.push({t:now,dx,dy});
    while (shakeTrail.length && now - shakeTrail[0].t > 650) shakeTrail.shift();
    const path = shakeTrail.reduce((sum,s) => sum + Math.hypot(s.dx,s.dy),0);
    let reversals = 0;
    let lastSign = 0;
    for (const item of shakeTrail) {
      if (Math.abs(item.dx) < 9) continue;
      const sign = Math.sign(item.dx);
      if (lastSign && sign !== lastSign) reversals++;
      lastSign = sign;
    }
    if (path >= 230 && reversals >= 3) {
      shakeLast = now;
      shakeTrail.length = 0;
      recenter(true);
    }
  }
  function requestVirtual() {
    if (locked) { document.exitPointerLock(); return; }
    if (!active) { note('Enable the engine first.'); return; }
    if (!bleConnected || airTouch !== true) { note('Connect Mudra and enable Air Touch in firmware first.'); return; }
    if (!document.documentElement.requestPointerLock) { note('Pointer Lock is not supported here.'); return; }
    try {
      const result = document.documentElement.requestPointerLock();
      if (result && result.catch) result.catch(() => note('Pointer Lock denied. Try another site or use normal mode.'));
    } catch (_) { note('Pointer Lock denied by browser or site.'); }
  }
  function onLockChange() {
    locked = document.pointerLockElement === document.documentElement;
    virtual = locked;
    shakeTrail.length = 0;
    if (locked) {
      pos.x = raw.x = innerWidth / 2; pos.y = raw.y = innerHeight / 2;
      if (airTouch !== true || !bleConnected) {
        document.exitPointerLock();
        return;
      }
      note('Virtual active. Shake to re-center; disable Air Touch to exit.');
    } else resetDwell();
    panelUpdate(); render();
  }
  function onLockError() { note('Pointer Lock unavailable on this page.'); }

  // Firmware contract taken from MudraFlutter:
  // FFF0 GATT service, FFF1 config/write+notify, 75 00 00 requests 0x01 map.
  // Map bytes: 0 header, 1 IMU header, 2 IMU master, 5..16 12 IMU flags;
  // byte 15 is imuSpecific[10] = Air Touch.
  function decodeSystemMap(value) {
    if (!value || value.length < 26 || value[0] !== 0x01) return null;
    if (![0,1].includes(value[2]) || ![0,1].includes(value[15])) return null;
    return { airTouch: value[2] === 1 && value[15] === 1, specific: value[15], imuMaster: value[2] };
  }
  function onFirmwareNotification(event) {
    const view = event.target.value;
    if (!view) return;
    const packet = new Uint8Array(view.buffer,view.byteOffset,view.byteLength);
    if (packet[0] !== 0x01) return;
    const decoded = decodeSystemMap(packet);
    if (!decoded) {
      lastError = 'System map not recognized (need current 26+ byte map).';
      panelUpdate();
      return;
    }
    lastError = '';
    mapAt = performance.now();
    const before = airTouch;
    airTouch = decoded.airTouch;
    if (airTouch === false && locked && document.exitPointerLock) document.exitPointerLock();
    if (before !== airTouch) {
      resetDwell();
      note(airTouch ? 'Firmware Air Touch ON. Click Enter virtual.' : 'Firmware Air Touch OFF. Normal HID cursor.');
    }
    panelUpdate();
  }
  function onBatteryNotification(event) {
    const view = event.target.value;
    if (view && view.byteLength >= 1) {
      const n = view.getUint8(0);
      if (n <= 100) { batteryLevel = n; panelUpdate(); }
    }
  }
  async function refreshBattery() {
    if (!bleConnected || !bleBattery) return;
    try { onBatteryNotification({target:{value:await bleBattery.readValue()}}); }
    catch (_) { /* Battery service may be unavailable for an active HID link. */ }
  }
  async function requestSystemMap() {
    if (!bleConnected || !bleCmd || bleWriting || dead) return;
    bleWriting = true;
    try {
      const payload = new Uint8Array([0x75,0x00,0x00]);
      if (bleCmd.properties.write) await bleCmd.writeValueWithResponse(payload);
      else if (bleCmd.properties.writeWithoutResponse) await bleCmd.writeValueWithoutResponse(payload);
      else throw new Error('Mudra command characteristic is not writable.');
    } catch (error) {
      lastError = 'Map poll: ' + String(error.message || error).slice(0,95);
      panelUpdate();
    } finally { bleWriting = false; }
  }
  function disconnectBle() {
    clearInterval(pollTimer); clearInterval(batteryTimer);
    pollTimer = batteryTimer = 0;
    if (bleCmd) {
      try { bleCmd.removeEventListener('characteristicvaluechanged', onFirmwareNotification); } catch (_) {}
    }
    if (bleBattery) {
      try { bleBattery.removeEventListener('characteristicvaluechanged', onBatteryNotification); } catch (_) {}
    }
    if (bleDevice) {
      try { bleDevice.removeEventListener('gattserverdisconnected', onDeviceDisconnected); } catch (_) {}
      try { if (bleDevice.gatt.connected) bleDevice.gatt.disconnect(); } catch (_) {}
    }
    bleDevice = bleCmd = bleBattery = null;
    bleConnected = false; bleBusy = false; bleWriting = false;
    airTouch = null; batteryLevel = null; mapAt = 0;
    lastError = '';
    if (locked && document.exitPointerLock) document.exitPointerLock();
    if (!dead) panelUpdate();
  }
  function onDeviceDisconnected() {
    disconnectBle();
    if (!dead) note('Mudra GATT disconnected. Normal HID mode restored.');
  }
  async function connectBle() {
    if (dead || bleBusy || bleConnected) return;
    if (!navigator.bluetooth || !navigator.bluetooth.requestDevice) {
      lastError = 'Web Bluetooth unavailable here. Use Chrome on HTTPS.';
      panelUpdate();
      return;
    }
    bleBusy = true; lastError = ''; panelUpdate();
    try {
      // Only the user can choose a device. Some HID-connected bands don't
      // advertise service UUIDs, so show all BLE devices in the chooser.
      const chosen = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true, optionalServices: [0xfff0,0x180f]
      });
      if (dead) return;
      bleDevice = chosen;
      chosen.addEventListener('gattserverdisconnected', onDeviceDisconnected);
      const gatt = await chosen.gatt.connect();
      const mudra = await gatt.getPrimaryService(0xfff0);
      const cmd = await mudra.getCharacteristic(0xfff1);
      await cmd.startNotifications();
      cmd.addEventListener('characteristicvaluechanged', onFirmwareNotification);
      bleCmd = cmd;
      bleConnected = true;
      try {
        const batteryService = await gatt.getPrimaryService(0x180f);
        bleBattery = await batteryService.getCharacteristic(0x2a19);
        if (bleBattery.properties.notify) {
          await bleBattery.startNotifications();
          bleBattery.addEventListener('characteristicvaluechanged', onBatteryNotification);
        }
        await refreshBattery();
      } catch (_) { /* Missing or Windows-protected BAS is nonfatal. */ }
      await requestSystemMap();
      pollTimer = setInterval(() => {
        if (mapAt && performance.now() - mapAt > 5000) {
          airTouch = null;
          if (locked && document.exitPointerLock) document.exitPointerLock();
          lastError = 'System-map response stale. Normal HID mode.';
          panelUpdate();
        }
        void requestSystemMap();
      },750);
      batteryTimer = setInterval(() => void refreshBattery(),30000);
      note('Mudra GATT connected. Listening for System Map.');
    } catch (error) {
      const message = String(error.message || error).slice(0,135);
      disconnectBle();
      lastError = 'BLE: ' + message;
      if (!dead) note('Mudra connection failed. ' + message);
    } finally {
      bleBusy = false; if (!dead) panelUpdate();
    }
  }

  function onKey(ev) {
    if (dead || !ev.altKey || !ev.shiftKey || ev.ctrlKey || ev.metaKey) return;
    const key = ev.key.toLowerCase();
    if (!['m', 'c', 'p', 'd'].includes(key)) return;
    ev.preventDefault(); ev.stopImmediatePropagation();
    if (key === 'm') { minimized = !minimized; panelUpdate(); }
    if (key === 'c') recenter(false);
    if (key === 'p') requestVirtual();
    if (key === 'd') { cfg.dwell = !cfg.dwell; persist(); panelUpdate(); resetDwell(); }
  }
  function togglePanel() { minimized = !minimized; panelUpdate(); }
  function stop() {
    if (dead) return;
    dead = true;
    if (locked && document.exitPointerLock) document.exitPointerLock();
    disconnectBle();
    clearTimeout(shakeTimer);
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
    cancelAnimationFrame(raf); clearTimeout(scanTimer); clearTimeout(toastTimer); clearInterval(ticker); clearTimeout(shakeTimer);
    host.remove(); if (window[KEY] && window[KEY].stop === stop) delete window[KEY];
  }
  $('close').addEventListener('click', stop);
  $('min').addEventListener('click', togglePanel);
  $('center').addEventListener('click', recenter);
  $('mode').addEventListener('click', requestVirtual);
  $('bleConnect').addEventListener('click', () => {
    if (bleConnected) disconnectBle(); else void connectBle();
  });
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
  window[KEY] = {stop, togglePanel, recenter, getState: () => ({cfg:Object.assign({},cfg),virtual,locked,active,bleConnected,airTouch,batteryLevel,mapAt,lastError})};
  panelUpdate(); scan(); note('Mudra Smart Cursor active');
})();
