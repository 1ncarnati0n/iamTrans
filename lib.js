// Pure helpers shared by content.js, background.js and test.js.
(function (g) {
  const PH = /⟦(\d+)⟧/g;

  // "a ⟦0⟧ b" -> ["a ", {id:0}, " b"]
  function splitPH(s) {
    return s.split(/⟦(\d+)⟧/).map((p, i) => (i % 2 ? { id: +p } : p)).filter((p) => p !== '');
  }

  function shouldTranslate(raw) {
    const t = raw.replace(PH, '').trim();
    const latin = (t.match(/[A-Za-z]/g) || []).length;
    if (latin < 2) return false;
    if ((t.match(/[가-힣]/g) || []).length > latin) return false; // already Korean
    const sym = (t.match(/[{}[\];=<>$\\|`]/g) || []).length;
    // ponytail: naive code-likeness heuristic, swap for a classifier if it misfires on real pages
    if (sym >= 3 && sym / t.length > 0.05) return false;
    return true;
  }

  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const toDeeplHtml = (s) => esc(s).replace(PH, '<span translate="no">⟦$1⟧</span>');
  const fromDeeplHtml = (s) =>
    s.replace(/<[^>]*>/g, '')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
      .replace(/&amp;/g, '&');

  g.IAT = { splitPH, shouldTranslate, toDeeplHtml, fromDeeplHtml };
  if (typeof module !== 'undefined') module.exports = g.IAT;
})(globalThis);
