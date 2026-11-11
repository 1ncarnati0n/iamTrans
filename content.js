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
  // Formatting kept in the translation (shallow-cloned around the translated words).
  const FORMAT = 'a,b,strong,em,i,u,s,mark,small,sub,sup,abbr,cite,q,del,ins,font,span[class],span[style]';
  const BATCH_CHARS = 4000, BATCH_ITEMS = 25;

  let engine = null, translator = null, io = null, mo = null, timer = null;
  const queue = new Set();
  let seen = new WeakSet();
  const cache = new Map(); // text -> translation, for the current engine only
  let rendered = []; // per block: { nodes, orig, ko } for in-place replace mode
  const isReplace = () => document.documentElement.classList.contains('iat-replace');
  const swap = (r, on) => r.nodes.forEach((n, i) => (n.data = on ? r.ko[i] : r.orig[i]));

  chrome.runtime.onMessage.addListener((m, _s, send) => {
    if (m.type === 'start') { start(m.engine); setMode(m.mode); }
    if (m.type === 'mode') setMode(m.mode);
    if (m.type === 'restore') restore();
    if (m.type === 'toggle') { if (engine) restore(); else { start(m.engine); setMode(m.mode); } }
    send({ ok: true });
  });

  // Replace mode swaps the original text nodes' data in place, so elements, classes and layout stay
  // exactly as they were; bilingual mode shows the appended .iat-t instead.
  function setMode(mode) {
    document.documentElement.classList.toggle('iat-replace', mode === 'replace');
    for (const r of rendered) swap(r, mode === 'replace');
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
    for (const r of rendered) swap(r, false);
    rendered = [];
    document.querySelectorAll('.iat-t').forEach((n) => n.remove());
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

  // Block -> text with ⟦n⟧ for inert nodes (code, math...) and ⟦n⟧…⟦/n⟧ around formatting (links, bold...).
  function serialize(el) {
    const keep = [];
    const kids = { '-1': [] }; // container id -> child-marker ids in order
    const slots = new Map([[-1, [[]]]]); // container id -> text nodes between its child markers
    let text = '', cont = -1;
    const marker = (id) => { kids[cont].push(id); slots.get(cont).push([]); };
    (function walk(n) {
      for (const c of n.childNodes) {
        if (c.nodeType === 3) { text += c.data; slots.get(cont).at(-1).push(c); }
        else if (c.nodeType !== 1) continue;
        else if (c.matches(SKIP)) {
          if (c.matches(DROP)) continue;
          const id = keep.length;
          keep.push({ node: c, inert: true });
          text += `⟦${id}⟧`; marker(id);
        }
        else if (c.tagName === 'BR') text += ' ';
        else if (c.matches(FORMAT) && c.textContent.trim()) {
          const id = keep.length, parent = cont;
          keep.push({ node: c });
          text += `⟦${id}⟧`; marker(id);
          kids[id] = []; slots.set(id, [[]]); cont = id;
          walk(c);
          cont = parent; text += `⟦/${id}⟧`;
        } else walk(c);
      }
    })(el);
    return { text: text.replace(/\s+/g, ' ').trim(), keep, kids, slots };
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

  // li > a > "text": render into the <a> itself so its block-level styling (menus, cards) applies.
  function target(el) {
    for (;;) {
      const kids = el.children;
      if (kids.length !== 1 || kids[0].matches(SKIP)) return el;
      for (const n of el.childNodes) if (n.nodeType === 3 && n.data.trim()) return el;
      el = kids[0];
    }
  }

  function render(item, translated) {
    const { el, keep } = item;
    if (!engine || !el.isConnected) return; // restored or gone meanwhile
    const out = document.createElement('span');
    out.className = 'iat-t';
    out.setAttribute('translate', 'no');
    out.lang = 'ko';
    const used = new Set();
    const stack = [{ id: -1, node: out }];
    const clone = (n, deep) => { const c = n.cloneNode(deep); c.removeAttribute?.('id'); return c; };
    for (const p of IAT.splitPH(translated)) {
      const top = stack[stack.length - 1].node;
      const k = keep[p.id];
      if (typeof p === 'string') top.append(p);
      else if (!k || (used.has(p.id) && !p.close)) continue; // unknown or duplicated marker
      else if (p.close) {
        const i = stack.findIndex((x) => x.id === p.id);
        if (i > 0) stack.length = i; // also closes anything the engine left open inside it
      } else if (k.inert) { used.add(p.id); top.append(clone(k.node, true)); }
      else { used.add(p.id); const c = clone(k.node, false); top.append(c); stack.push({ id: p.id, node: c }); }
    }
    // Engine dropped an inert marker: keep the code/math anyway. Dropped formatting just becomes plain text.
    keep.forEach((k, i) => { if (k.inert && !used.has(i)) out.append(' ', clone(k.node, true)); });
    el.append(out);
    const r = replaceRecord(item, translated);
    rendered.push(r);
    if (isReplace()) swap(r, true);
  }

  // Which Korean text goes into which original text node.
  function replaceRecord({ kids, slots }, translated) {
    const nodes = [...slots.values()].flat(2);
    const ko = new Map(nodes.map((n) => [n, '']));
    const pieces = IAT.distribute(translated, kids);
    if (pieces) {
      for (const [id, ss] of slots) {
        let carry = '', last = null;
        ss.forEach((slotNodes, k) => {
          let piece = carry + pieces[id][k];
          carry = '';
          if (!slotNodes.length) { carry = piece; return; } // no text node here: move it along
          // keep a separating space between neighbouring elements when this slot ends up empty
          if (!piece && /\s/.test(slotNodes.map((n) => n.data).join(''))) piece = ' ';
          ko.set(slotNodes[0], piece);
          last = slotNodes[0];
        });
        if (carry && last) ko.set(last, ko.get(last) + carry);
      }
    } else if (nodes.length) {
      // ponytail: markers lost or reordered -> whole sentence in the first text node; links in it go empty
      ko.set(nodes[0], translated.replace(/⟦\/?\d+⟧/g, ''));
    }
    return { nodes, orig: nodes.map((n) => n.data), ko: nodes.map((n) => ko.get(n)) };
  }
})();
