(function () {
  var report = { userAgent: navigator.userAgent, pads: [], errors: [] };
  window.onerror = function (message, source, line, column, error) {
    var entry = {message:String(message).slice(0,1000), source:(source || '').split('/').pop().split(/[?#]/)[0],
      line:line, column:column, stack:error && typeof error.stack === 'string' ? error.stack.slice(0,4000) : ''};
    if (report.errors.length >= 8) report.errors.shift();
    report.errors.push(entry);
    document.getElementById('diagnostic-error').textContent = 'Diagnostics failed. ' + entry.message;
    if (endpoint) changed();
  };
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
  function flexGap() {
    var box = document.createElement('div');
    box.style.cssText = 'position:absolute;visibility:hidden;display:flex;flex-direction:column;row-gap:1px';
    box.appendChild(document.createElement('div')); box.appendChild(document.createElement('div'));
    document.body.appendChild(box);
    var supported = box.scrollHeight === 1;
    box.remove();
    return supported;
  }
  Object.assign(report, { userAgent: navigator.userAgent, viewport: [innerWidth,innerHeight], dpr: devicePixelRatio,
    webgl1: graphics('webgl'), webgl2: graphics('webgl2'), websocket: 'connecting', fps: null,
    features: { gamepads: typeof navigator.getGamepads === 'function', indexedDB: !!window.indexedDB,
      replaceChildren: !!Element.prototype.replaceChildren, arrayAt: !!Array.prototype.at,
      performanceMemory: !!performance.memory, flexGap: flexGap(), moduleScript: null, dynamicImport: null,
      cssInset: CSS.supports('inset', '0'), secureContext: window.isSecureContext },
    keys: [], padChanges: [], controls: {}, pads: [] });
  var moduleScript = document.createElement('script');
  moduleScript.type = 'module'; moduleScript.src = '/module-probe.js';
  moduleScript.onload = function () { report.features.moduleScript = true; changed(); };
  moduleScript.onerror = function () { report.features.moduleScript = false; changed(); };
  document.head.appendChild(moduleScript);
  // Keep the diagnostic entry ES2017. Only the isolated probe parses import().
  try {
    var importProbe = new Function('return import("/module-probe.js")');
    importProbe().then(function (module) {
      report.features.dynamicImport = module.loaded === true; changed();
    },function () { report.features.dynamicImport = false; changed(); });
  } catch (_) { report.features.dynamicImport = false; }
  setTimeout(function () {
    if (report.features.moduleScript === null) report.features.moduleScript = false;
    if (report.features.dynamicImport === null) report.features.dynamicImport = false;
    changed();
  },3000);
  var lastValues = {};
  function correlate(change,key) {
    var delta = key.ms - change[0];
    if (Math.abs(delta) <= 100 && (!change[5] || Math.abs(delta) < Math.abs(change[5].deltaMs))) {
      change[5] = {deltaMs:delta,code:key.code,keyCode:key.keyCode};
    }
  }
  function transitions(index, kind, values, now) {
    var key = index + kind, old = lastValues[key] || [];
    values.forEach(function (v, i) {
      if (old[i] === undefined || Math.abs(old[i] - v) >= 0.1 || (v === 0 && old[i] !== 0)) {
        var change = [Math.round(now), index, kind, i, v, null];
        for (var j = report.keys.length-1; j >= 0 && change[0]-report.keys[j].ms <= 100; j--)
          correlate(change,report.keys[j]);
        report.padChanges.push(change);
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
    var body = JSON.stringify(report);
    // Preserve the newest error and the current snapshot within the proxy's byte limit.
    while (new Blob([body]).size > 64000) {
      if (report.errors.length > 1) report.errors.shift();
      else if (report.padChanges && report.padChanges.length) report.padChanges.splice(0,32);
      else if (report.keys && report.keys.length) report.keys.splice(0,16);
      else break;
      body = JSON.stringify(report);
    }
    fetch(endpoint, { method: 'POST', headers: { 'Content-Type':'application/json' }, body: body })
      .then(function (r) { if (!r.ok) throw Error('HTTP ' + r.status); status.textContent = 'Report saved on host.'; })
      .catch(function (e) { status.textContent = 'Save failed: ' + e.message; })
      .then(function () { busy = false; if (dirty) save(); });
  }
  function changed() { if (!timer) timer = setTimeout(function () { timer = null; save(); }, 650); }
  document.onkeydown = function (e) {
    if (e.keyCode === 461) { e.preventDefault(); document.getElementById('save').focus(); }
    var key = { ms: Math.round(performance.now()), code: e.code, keyCode: e.keyCode, repeat: e.repeat };
    report.keys.push(key);
    for (var i = report.padChanges.length-1; i >= 0 && key.ms-report.padChanges[i][0] <= 100; i--)
      correlate(report.padChanges[i],key);
    if (report.keys.length > 256) report.keys.shift();
    changed();
  };
  document.getElementById('save').onclick = function () {
    // Only the operator knows that a stable trigger is resting, rather than held.
    report.pads.forEach(function (pad) {
      var samples = report.controls[pad.index].axisSamples;
      pad.axes.forEach(function (value,i) { if (samples[i].used) samples[i].resting = value; });
    });
    save();
  };
  document.getElementById('play').onclick = function () {
    var game = '/jamera.html' + location.search;
    if (params.has('reset-pad')) {
      params.delete('reset-pad');
      history.replaceState(history.state, '', location.pathname + '?' + params.toString());
    }
    location.href = game;
  };
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
        var limits = report.controls[p.index];
        if (!limits || limits.id !== p.id) {
          limits = {id:p.id,buttons:[],axes:[],axisSamples:[]};
          delete lastValues[p.index + 'button']; delete lastValues[p.index + 'axis'];
        }
        var sampledAt = performance.now();
        transitions(p.index, 'button', values, sampledAt);
        transitions(p.index, 'axis', axes, sampledAt);
        axes.forEach(function (value,i) {
          var sample = limits.axisSamples[i] || {first:value,used:false,resting:null};
          if (Math.abs(value-sample.first) >= .12) sample.used = true;
          limits.axisSamples[i] = sample;
        });
        values.forEach(function (v,i) { limits.buttons[i] = Math.max(v, limits.buttons[i] || 0); });
        axes.forEach(function (v,i) { var a = limits.axes[i] || [v,v]; limits.axes[i] = [Math.min(a[0],v), Math.max(a[1],v)]; });
        report.controls[p.index] = limits;
        return { index:p.index, id: p.id, mapping: p.mapping, buttonCount: values.length, axisCount: axes.length, buttons: values, axes: axes };
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
