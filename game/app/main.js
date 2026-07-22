/* «Пепел Литаний» — точка входа. */
'use strict';
(function () {
  function boot() {
    UI.init();
    /* если есть сейв с активным боем — сразу предлагаем продолжить с титула */
    UI.renderTitle();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
