// Lightweight flexible adapter for mobile rem scaling.
(function (win, doc) {
  var docEl = doc.documentElement;
  var baseWidth = 375;
  var maxWidth = 540;

  function refreshRem() {
    var width = docEl.getBoundingClientRect().width;
    if (!width) return;
    if (width > maxWidth) width = maxWidth;
    var rem = (width / baseWidth) * 16;
    docEl.style.fontSize = rem + 'px';
  }

  refreshRem();
  win.addEventListener('resize', refreshRem);
  win.addEventListener('orientationchange', refreshRem);
})(window, document);
