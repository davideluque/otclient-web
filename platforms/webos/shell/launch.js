(function () {
  var destination, sequence = 0, previous = false;
  var status = document.getElementById('message');
  var retry = document.querySelector('button');
  function read(params) {
    try {
      var origin = params && params.origin || localStorage.getItem('origin');
      var url = new URL(origin);
      if (url.protocol !== 'http:' || url.username || url.password) throw Error();
      destination = new URL(params && String(params.diagnostics) === 'true' ? '/diagnostics.html' : '/jamera.html', url.origin);
      destination.searchParams.set('tv', '1');
      destination.searchParams.set('metrics', '1');
      var port = params && params.proxyPort || localStorage.getItem('proxyPort') || '8090';
      destination.searchParams.set('proxy', 'ws://' + url.hostname + ':' + port);
      if (params && String(params.resetPad) === 'true') destination.searchParams.set('reset-pad', '1');
      if (params && String(params.logs) === 'true') destination.searchParams.set('tvlogs', '1');
      try { localStorage.setItem('origin', url.origin); localStorage.setItem('proxyPort', port); } catch (_) {}
    } catch (_) {
      if (!destination) status.textContent = 'Launch once from your host with npm run tv:launch.';
    }
  }
  function connect() {
    if (!destination) return;
    var current = ++sequence, probe = new Image();
    status.textContent = 'Connecting to ' + destination.host + '…';
    function failed() {
      if (current !== sequence) return;
      sequence++;
      status.textContent = "Can't reach " + destination.host + '. Is the server running?';
      retry.focus();
    }
    var timer = setTimeout(failed, 5000);
    probe.onload = function () { clearTimeout(timer); if (current === sequence) location.replace(destination.href); };
    probe.onerror = function () { clearTimeout(timer); failed(); };
    probe.src = destination.origin + '/icon-180.png?t=' + Date.now();
  }
  function launch(params) { read(params); connect(); }
  document.addEventListener('webOSLaunch', function (e) { launch(e.detail); });
  document.addEventListener('webOSRelaunch', function (e) { launch(e.detail); });
  retry.onclick = connect;
  document.addEventListener('keydown', function (e) {
    if (e.keyCode === 461) { e.preventDefault(); retry.focus(); }
  });
  function poll() {
    try {
      var pads = navigator.getGamepads ? navigator.getGamepads() : [];
      var down = Array.prototype.some.call(pads, function (p) {
        return p && p.buttons.some(function (b) { return b.pressed; });
      });
      if (down && !previous) connect();
      previous = down;
    } catch (_) {}
    requestAnimationFrame(poll);
  }
  poll();
  var system = window.webOSSystem || window.PalmSystem;
  var params;
  try { params = JSON.parse(system.launchParams); } catch (_) {}
  launch(params);
})();
