(function () {
  var params = new URLSearchParams(location.search);
  var ws = new URL(params.get('proxy') || ('ws://' + location.hostname + ':8090'));
  if (ws.hostname !== location.hostname || !/^wss?:$/.test(ws.protocol)) throw Error('Invalid diagnostics proxy');
  var endpoint = ws.origin.replace(/^ws/, 'http') + '/tv/report';
  function graphics(type) {
    try {
      var gl = document.createElement('canvas').getContext(type);
      if (!gl) return null;
      var ext = gl.getExtension('WEBGL_debug_renderer_info');
      var result = { renderer: gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER),
        maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE) };
      var lose = gl.getExtension('WEBGL_lose_context');
      if (lose) lose.loseContext();
      return result;
    } catch (e) { return { error: e.name }; }
  }
  var report = { userAgent: navigator.userAgent, viewport: [innerWidth,innerHeight], dpr: devicePixelRatio,
    webgl1: graphics('webgl'), webgl2: graphics('webgl2'), websocket: 'connecting', fps: null,
    features: { gamepads: typeof navigator.getGamepads === 'function', indexedDB: !!window.indexedDB,
      replaceChildren: !!Element.prototype.replaceChildren, arrayAt: !!Array.prototype.at,
      cssInset: CSS.supports('inset', '0'), secureContext: window.isSecureContext },
    keys: [], padChanges: [], controls: {}, pads: [] };
  var lastValues = {};
  function transitions(index, kind, values, now) {
    var key = index + kind, old = lastValues[key] || [];
    values.forEach(function (v, i) {
      if (old[i] === undefined || Math.abs(old[i] - v) >= 0.1 || (v === 0 && old[i] !== 0)) {
        report.padChanges.push([Math.round(now), index, kind, i, v]);
        old[i] = v;
      }
    });
    if (report.padChanges.length > 384) report.padChanges.splice(0, report.padChanges.length - 384);
    lastValues[key] = old;
  }
  var timer, busy = false, dirty = false;
  function save() {
    dirty = true;
    if (busy) return;
    busy = true;
    dirty = false;
    var status = document.getElementById('status');
    fetch(endpoint, { method: 'POST', headers: { 'Content-Type':'application/json' }, body: JSON.stringify(report) })
      .then(function (r) { if (!r.ok) throw Error('HTTP ' + r.status); status.textContent = 'Report saved on host.'; })
      .catch(function (e) { status.textContent = 'Save failed: ' + e.message; })
      .then(function () { busy = false; if (dirty) save(); });
  }
  function changed() { if (!timer) timer = setTimeout(function () { timer = null; save(); }, 650); }
  document.onkeydown = function (e) {
    if (e.keyCode === 461) { e.preventDefault(); document.getElementById('save').focus(); }
    report.keys.push({ ms: Math.round(performance.now()), code: e.code, keyCode: e.keyCode, repeat: e.repeat });
    if (report.keys.length > 256) report.keys.shift();
    changed();
  };
  document.getElementById('save').onclick = save;
  document.getElementById('play').onclick = function () { location.href = '/jamera.html' + location.search; };
  var start = performance.now();
  try {
    var socket = new WebSocket(ws.origin + '/tv/ping');
    var timeout = setTimeout(function () { report.websocket = 'timed out'; socket.close(); changed(); }, 5000);
    socket.onopen = function () { start = performance.now(); socket.send('ping'); };
    socket.onmessage = function (e) {
      clearTimeout(timeout);
      report.websocket = e.data === 'pong' ? { roundTripMs: performance.now()-start } : 'unexpected reply';
      socket.close(); changed();
    };
    socket.onerror = function () { clearTimeout(timeout); report.websocket = 'failed'; changed(); };
  } catch (e) { report.websocket = e.name; }
  var first, frames = 0, nextDraw = 0, last = '';
  function tick(now) {
    if (first === undefined) first = now;
    else frames++;
    if (report.fps === null && now-first >= 5000) { report.fps = frames*1000/(now-first); changed(); }
    try {
      report.pads = Array.from(navigator.getGamepads ? navigator.getGamepads() : []).filter(Boolean).map(function (p) {
        var values = p.buttons.map(function (b) { return b.value; });
        var axes = p.axes.map(function (v) { return Math.round(v*1000)/1000; });
        transitions(p.index, 'button', values, now);
        transitions(p.index, 'axis', axes, now);
        var limits = report.controls[p.index] || { buttons: [], axes: [] };
        values.forEach(function (v,i) { limits.buttons[i] = Math.max(v, limits.buttons[i] || 0); });
        axes.forEach(function (v,i) { var a = limits.axes[i] || [v,v]; limits.axes[i] = [Math.min(a[0],v), Math.max(a[1],v)]; });
        report.controls[p.index] = limits;
        return { id: p.id, mapping: p.mapping, buttonCount: values.length, axisCount: axes.length, buttons: values, axes: axes };
      });
    } catch (e) { report.gamepadError = e.name; }
    if (now >= nextDraw) {
      var text = JSON.stringify(report,null,2);
      var lines = [report.userAgent, 'Viewport ' + report.viewport.join(' × ') + ' · DPR ' + report.dpr,
        'WebGL 1 ' + JSON.stringify(report.webgl1), 'WebGL 2 ' + JSON.stringify(report.webgl2),
        'WebSocket ' + JSON.stringify(report.websocket) + ' · rAF ' + (report.fps === null ? 'measuring…' : report.fps.toFixed(1) + ' fps'),
        'Features ' + JSON.stringify(report.features)];
      if (report.gamepadError) lines.push('Gamepad API error: ' + report.gamepadError);
      else if (!report.pads.length) lines.push('No visible controller. Press and release a button.');
      report.pads.forEach(function (p) {
        lines.push(p.id + ' · mapping ' + JSON.stringify(p.mapping), p.buttonCount + ' buttons: ' + p.buttons.join(' '),
          p.axisCount + ' axes: ' + p.axes.join(' '));
      });
      lines.push('Recent keys ' + report.keys.slice(-5).map(function (k) { return k.code + '/' + k.keyCode; }).join(', '));
      document.getElementById('screen').textContent = lines.join('\n');
      if (last !== text) changed();
      last = text; nextDraw = now + 150;
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
})();
