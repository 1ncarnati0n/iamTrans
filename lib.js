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

  // Split a translation back onto the original structure for in-place replacement.
  // kids: {containerId: [child-marker ids in source order]} for the block root (-1) and every formatting
  // element; ids that aren't keys are inert (code, math). Returns {containerId: [text per slot]}, where
  // slot k is the text after the k-th child, or null when formatting markers were dropped or reordered.
  function distribute(translated, kids) {
    const isFmt = (id) => id in kids;
    const got = {}, pieces = {}, stack = [-1];
    for (const c in kids) { got[c] = []; pieces[c] = ['']; }
    for (const p of splitPH(translated)) {
      const top = stack[stack.length - 1];
      if (typeof p === 'string') pieces[top][pieces[top].length - 1] += p;
      else if (p.close) { if (top !== p.id) return null; stack.pop(); }
      else { got[top].push(p.id); pieces[top].push(''); if (isFmt(p.id)) stack.push(p.id); }
    }
    if (stack.length !== 1) return null;
    const fmt = (ids) => ids.filter(isFmt).join();
    const out = {};
    for (const c in kids) {
      if (fmt(got[c]) !== fmt(kids[c])) return null;
      if (got[c].join() === kids[c].join()) { out[c] = pieces[c]; continue; }
      // Only inert markers moved or vanished: the code/math stays where it is in the page, so pour
      // each stretch of text between formatting elements into the first slot of that stretch.
      out[c] = Array(kids[c].length + 1).fill('');
      const starts = [0];
      kids[c].forEach((id, i) => { if (isFmt(id)) starts.push(i + 1); });
      let seg = 0;
      pieces[c].forEach((t, i) => {
        if (i > 0 && isFmt(got[c][i - 1])) seg++;
        out[c][starts[seg]] += t;
      });
    }
    return out;
  }

  // KEY=value lines; # comments, blank lines and surrounding quotes ignored.
  const parseEnv = (text) =>
    Object.fromEntries(text.split(/\r?\n/)
      .map((l) => l.match(/^\s*(?:export\s+)?([\w.]+)\s*=\s*(.*?)\s*$/)).filter(Boolean)
      .map(([, k, v]) => [k, v.replace(/^(['"])(.*)\1$/, '$2')]));

  g.IAT = { splitPH, shouldTranslate, toDeeplHtml, fromDeeplHtml, distribute, parseEnv };
  if (typeof module !== 'undefined') module.exports = g.IAT;
})(globalThis);
