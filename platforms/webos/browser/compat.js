// Synchronous, TV distribution only. Install before the game module graph.
(function () {
  if (!Element.prototype.replaceChildren) {
    Object.defineProperty(Element.prototype, 'replaceChildren', { configurable: true, writable: true, value: function () {
      var contents = document.createDocumentFragment();
      contents.append.apply(contents, arguments);
      this.textContent = '';
      this.appendChild(contents);
    } });
  }
  if (!Array.prototype.at) {
    Object.defineProperty(Array.prototype, 'at', { configurable: true, writable: true, value: function (index) {
      var i = Math.trunc(Number(index)) || 0;
      if (i < 0) i += this.length;
      return i < 0 || i >= this.length ? undefined : this[i];
    } });
  }

  // Static module facades keep optional features lazy with ES2019 grammar.
  var pending = Object.create(null);
  window.tvImport = function (url) {
    if (!pending[url]) {
      var script = document.createElement('script');
      script.type = 'module';
      pending[url] = new Promise(function (resolve, reject) {
        script.onload = function () { resolve(window.tvModules[url]); script.remove(); };
        script.onerror = function () { delete pending[url]; reject(new Error('Loading ' + url)); script.remove(); };
        script.src = url;
        document.head.appendChild(script);
      });
    }
    return pending[url];
  };
  window.tvModules = Object.create(null);
})();
