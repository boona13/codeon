(() => {
  'use strict';

function shellQuote(s) {
  const str = String(s ?? '');
  if (str === '') return "''";
  // Safe for /bin/sh (single-quote with escape via: '\'' => '"'"')
  return `'${str.replace(/'/g, `'"'"'`)}'`;
}

  window.Codeon = window.Codeon || {};
  window.Codeon.utils = window.Codeon.utils || {};
  window.Codeon.utils.shellQuote = shellQuote;
})();
