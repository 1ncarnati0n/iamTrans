// node test.js
const assert = require('assert');
const { splitPH, shouldTranslate, toDeeplHtml, fromDeeplHtml, distribute } = require('./lib.js');

assert.deepStrictEqual(splitPH('Call ⟦0⟧ then ⟦1⟧.'), ['Call ', { id: 0 }, ' then ', { id: 1 }, '.']);
assert.deepStrictEqual(splitPH('⟦0⟧'), [{ id: 0 }]);
assert.deepStrictEqual(splitPH('See ⟦0⟧the ⟦1⟧docs⟦/1⟧⟦/0⟧!'),
  ['See ', { id: 0 }, 'the ', { id: 1 }, 'docs', { id: 1, close: true }, { id: 0, close: true }, '!']);
assert(!shouldTranslate('⟦0⟧⟦/0⟧'));

assert(shouldTranslate('Hello world (and friends).'));
assert(shouldTranslate('Use ⟦0⟧ to install the package.'));
assert(!shouldTranslate('⟦0⟧'));
assert(!shouldTranslate('42 / 7'));
assert(!shouldTranslate('이미 한국어 문장입니다 OK'));
assert(!shouldTranslate('const x = {a: 1}; if (x[0] < y) {}'));

const h = toDeeplHtml('a < b & ⟦0⟧');
assert.strictEqual(h, 'a &lt; b &amp; <span translate="no">⟦0⟧</span>');
assert.strictEqual(fromDeeplHtml('가 &lt; 나 &amp; <span translate="no">⟦0⟧</span>'), '가 < 나 & ⟦0⟧');
// paired markers round-trip through real tags, nesting preserved
const src = 'Read ⟦0⟧the ⟦1⟧guide⟦/1⟧⟦/0⟧ with ⟦2⟧ now';
const html = toDeeplHtml(src);
assert.strictEqual(html, 'Read <b data-k="0">the <b data-k="1">guide</b></b> with <span translate="no">⟦2⟧</span> now');
assert.strictEqual(fromDeeplHtml(html), src);

// distribute: word order changes around a single link
assert.deepStrictEqual(
  distribute('먼저 ⟦0⟧문서⟦/0⟧를 읽으세요', { '-1': [0], 0: [] }),
  { '-1': ['먼저 ', '를 읽으세요'], 0: ['문서'] });
// nested formatting + inert code in place
assert.deepStrictEqual(
  distribute('⟦0⟧공식 ⟦1⟧문서⟦/1⟧⟦/0⟧를 보고 ⟦2⟧ 실행', { '-1': [0, 2], 0: [1], 1: [] }),
  { '-1': ['', '를 보고 ', ' 실행'], 0: ['공식 ', ''], 1: ['문서'] });
// engine moved inline code: links still line up, text between links pooled into the first slot
assert.deepStrictEqual(
  distribute('⟦2⟧ 실행 전에 ⟦0⟧문서⟦/0⟧를 읽으세요.', { '-1': [0, 2], 0: [] }),
  { '-1': [' 실행 전에 ', '를 읽으세요.', ''], 0: ['문서'] });
// engine dropped inline code marker: same pooling
assert.deepStrictEqual(
  distribute('⟦0⟧문서⟦/0⟧를 읽고 실행', { '-1': [0, 2], 0: [] }),
  { '-1': ['', '를 읽고 실행', ''], 0: ['문서'] });
// engine swapped two links -> fallback
assert.strictEqual(distribute('⟦1⟧나⟦/1⟧ 그리고 ⟦0⟧가⟦/0⟧', { '-1': [0, 1], 0: [], 1: [] }), null);
// engine dropped a link marker -> fallback
assert.strictEqual(distribute('문서를 읽으세요', { '-1': [0], 0: [] }), null);
// unbalanced -> fallback
assert.strictEqual(distribute('⟦0⟧문서 읽기', { '-1': [0], 0: [] }), null);

console.log('ok');
