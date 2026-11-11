// Immersive translation: find leaf text blocks, translate them when they enter the viewport,
// append the translation inside the block. "replace" mode just hides the original via CSS,
// so switching modes never re-requests and the page's own nodes are never rewritten.
(() => {
  // Inert inline nodes: kept verbatim (cloned) inside a translated sentence.
  const INERT = 'code,kbd,samp,var,math,.katex,.MathJax,mjx-container,svg,img,picture,[translate="no"],.notranslate';
  // Interactive / dev UI: never translated, and a block containing one is left alone.
  const HARD = [
    'pre', 'textarea', 'input', 'select', 'option', 'button', 'iframe', 'video', 'audio', 'canvas', '.katex-display',
    '.CodeMirror', '.cm-editor', '.monaco-editor', '.ace_editor', '.xterm',
    '[contenteditable]:not([contenteditable="false"])', '[role="textbox"]', '[role="code"]',
  ].join(',');
  const DROP = 'script,style,noscript,template'; // ignored without a placeholder
  const SKIP = [INERT, HARD, DROP, '.iat-t', '.iat-toast'].join(',');
  const BLOCK = 'p,li,h1,h2,h3,h4,h5,h6,td,th,dd,dt,blockquote,figcaption,caption,summary,label,div,section,article,aside,header,footer,main,nav';
  const BREAK = [BLOCK, 'table,ul,ol,hr', HARD].join(',');
  const BATCH_CHARS = 4000, BATCH_ITEMS = 25;

  let engine = null, translator = null, io = null, mo = null, timer = null;
  const queue = new Set();
  let seen = new WeakSet();
  const cache = new Map(); // text -> translation, for the current engine only

  chrome.runtime.onMessage.addListener((m, _s, send) => {
    if (m.type === 'start') { start(m.engine); setMode(m.mode); }
    if (m.type === 'mode') setMode(m.mode);
    if (m.type === 'restore') restore();
    send({ ok: true });
  });

  function setMode(mode) {
    document.documentElement.classList.toggle('iat-replace', mode === 'replace');
  }

  function start(e) {
    if (engine !== e) { restore(); translator = null; cache.clear(); }
    engine = e;
    if (io) return;
    io = new IntersectionObserver((entries) => {
      for (const en of entries) if (en.isIntersecting) { io.unobserve(en.target); queue.add(en.target); }
      if (queue.size) { clearTimeout(timer); timer = setTimeout(flush, 150); }
    }, { rootMargin: '300px 0px' });
    scan(document.body);
    mo = new MutationObserver((muts) => {
      for (const m of muts) for (const n of m.addedNodes) {
        if (n.nodeType === 1 && !n.classList.contains('iat-t')) scan(n);
      }
    });
    mo.observe(document.body, { childList: true, subtree: true });
  }

  function restore() {
    stop();
    document.querySelectorAll('.iat-t').forEach((n) => n.remove());
    document.querySelectorAll('.iat-src').forEach((n) => n.classList.remove('iat-src'));
    document.documentElement.classList.remove('iat-replace');
    document.querySelector('.iat-toast')?.remove();
    engine = null;
    seen = new WeakSet();
  }

  function scan(root) {
    const els = root.matches?.(BLOCK) ? [root, ...root.querySelectorAll(BLOCK)] : root.querySelectorAll(BLOCK);
    for (const el of els) {
      if (seen.has(el) || el.closest(SKIP) || el.querySelector(BREAK)) continue; // leaf blocks only
      seen.add(el);
      io.observe(el);
    }
  }

  // Block -> text with ⟦n⟧ for protected inline nodes (code, math...).
  function serialize(el) {
    const keep = [];
    let text = '';
    (function walk(n) {
      for (const c of n.childNodes) {
        if (c.nodeType === 3) text += c.data;
        else if (c.nodeType !== 1) continue;
        else if (c.matches(SKIP)) { if (!c.matches(DROP)) { text += `⟦${keep.length}⟧`; keep.push(c); } }
        else if (c.tagName === 'BR') text += ' ';
        else walk(c);
      }
    })(el);
    return { text: text.replace(/\s+/g, ' ').trim(), keep };
  }

  async function flush() {
    const items = [];
    for (const el of queue) {
      queue.delete(el);
      if (!el.isConnected) continue;
      const t = target(el);
      const s = serialize(t);
      if (IAT.shouldTranslate(s.text)) items.push({ el: t, ...s });
    }
    while (items.length) {
      const batch = [];
      let chars = 0;
      while (items.length && batch.length < BATCH_ITEMS && chars < BATCH_CHARS) {
        chars += items[0].text.length;
        batch.push(items.shift());
      }
      const todo = batch.filter((b) => !cache.has(b.text));
      try {
        if (todo.length) {
          const out = await translate(todo.map((b) => b.text));
          todo.forEach((b, i) => cache.set(b.text, out[i]));
        }
        for (const b of batch) render(b, cache.get(b.text));
      } catch (e) {
        // Leave failed blocks untouched and stop, instead of hiding the page behind error text.
        console.warn('[iamTrans]', e);
        stop();
        toast('번역 실패: ' + e.message);
        return;
      }
    }
  }

  async function translate(texts) {
    if (engine === 'chrome') {
      translator ??= await chromeTranslator();
      return Promise.all(texts.map((t) => translator.translate(t)));
    }
    const r = await chrome.runtime.sendMessage({ type: 'translate', engine, texts });
    if (r.error) throw new Error(r.error);
    return r.result;
  }

  // Chrome only lets a site create a translator after a user gesture *in that page*;
  // the popup click doesn't count, so ask for one click on the page if needed.
  async function chromeTranslator() {
    if (!('Translator' in self)) throw new Error('이 페이지에서 Chrome 내장 Translator API를 쓸 수 없습니다');
    const opts = { sourceLanguage: 'en', targetLanguage: 'ko' };
    try {
      return await Translator.create(opts);
    } catch (e) {
      if (e.name !== 'NotAllowedError') throw e;
      await new Promise((ok) => toast('이 사이트에서 Chrome 번역을 처음 사용합니다.', '시작', ok));
      return Translator.create(opts);
    }
  }

  function stop() {
    io?.disconnect(); mo?.disconnect(); io = mo = null; queue.clear();
  }

  function toast(text, button, onClick) {
    document.querySelector('.iat-toast')?.remove();
    const t = document.createElement('div');
    t.className = 'iat-toast';
    t.setAttribute('translate', 'no');
    t.append(text);
    const b = document.createElement('button');
    b.textContent = button || '닫기';
    b.onclick = () => { t.remove(); onClick?.(); };
    t.append(' ', b);
    document.documentElement.append(t);
  }

  // li > a > "text": render into the <a> so the link survives replace mode.
  // ponytail: only whole-block wrappers; links mid-sentence still become plain text (needs paired markers).
  function target(el) {
    for (;;) {
      const kids = el.children;
      if (kids.length !== 1 || kids[0].matches(SKIP)) return el;
      for (const n of el.childNodes) if (n.nodeType === 3 && n.data.trim()) return el;
      el = kids[0];
    }
  }

  function render({ el, keep }, translated) {
    if (!engine || !el.isConnected) return; // restored or gone meanwhile
    const out = document.createElement('span');
    out.className = 'iat-t';
    out.setAttribute('translate', 'no');
    out.lang = 'ko';
    const used = new Set();
    for (const p of IAT.splitPH(translated)) {
      if (typeof p === 'string') out.append(p);
      else if (keep[p.id] && !used.has(p.id)) { used.add(p.id); out.append(keep[p.id].cloneNode(true)); }
    }
    keep.forEach((k, i) => { if (!used.has(i)) out.append(' ', k.cloneNode(true)); }); // engine dropped a placeholder
    el.style.setProperty('--iat-fs', getComputedStyle(el).fontSize);
    el.classList.add('iat-src');
    el.append(out);
  }
})();
