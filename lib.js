// Pure helpers shared by content.js, background.js and test.js.
(function (g) {
  // Markers: ⟦n⟧ = inert node (code, math, img) or the start of a formatting element (a, b, em...);
  // ⟦/n⟧ = end of formatting element n. A ⟦n⟧ with a matching ⟦/n⟧ is an opening marker.
  const PH = /⟦\/?\d+⟧/g;

  // "a ⟦0⟧b⟦/0⟧" -> ["a ", {id:0}, "b", {id:0, close:true}]
  function splitPH(s) {
    return s.split(/⟦(\/?)(\d+)⟧/).reduce((out, p, i, arr) => {
      if (i % 3 === 0) { if (p) out.push(p); }
      else if (i % 3 === 1) out.push(p ? { id: +arr[i + 1], close: true } : { id: +arr[i + 1] });
      return out;
    }, []);
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
  // Paired markers become real tags so DeepL moves them with the words; inert ones are protected.
  const toDeeplHtml = (s) =>
    esc(s).replace(/⟦(\/?)(\d+)⟧/g, (m, close, n) =>
      close ? '</b>' : s.includes(`⟦/${n}⟧`) ? `<b data-k="${n}">` : `<span translate="no">⟦${n}⟧</span>`);
  const fromDeeplHtml = (s) => {
    const open = [];
    return s.replace(/<(\/?)(\w+)([^>]*)>/g, (m, close, tag, attrs) => {
      if (tag !== 'b') return '';
      if (!close) { const k = /data-k="(\d+)"/.exec(attrs); open.push(k ? k[1] : null); return k ? `⟦${k[1]}⟧` : ''; }
      const k = open.pop();
      return k != null ? `⟦/${k}⟧` : '';
    })
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
      .replace(/&amp;/g, '&');
  };

  g.IAT = { splitPH, shouldTranslate, toDeeplHtml, fromDeeplHtml };
  if (typeof module !== 'undefined') module.exports = g.IAT;
})(globalThis);
