// node test.js
const assert = require('assert');
const { splitPH, shouldTranslate, toDeeplHtml, fromDeeplHtml } = require('./lib.js');

assert.deepStrictEqual(splitPH('Call ⟦0⟧ then ⟦1⟧.'), ['Call ', { id: 0 }, ' then ', { id: 1 }, '.']);
assert.deepStrictEqual(splitPH('⟦0⟧'), [{ id: 0 }]);

assert(shouldTranslate('Hello world (and friends).'));
assert(shouldTranslate('Use ⟦0⟧ to install the package.'));
assert(!shouldTranslate('⟦0⟧'));
assert(!shouldTranslate('42 / 7'));
assert(!shouldTranslate('이미 한국어 문장입니다 OK'));
assert(!shouldTranslate('const x = {a: 1}; if (x[0] < y) {}'));

const h = toDeeplHtml('a < b & ⟦0⟧');
assert.strictEqual(h, 'a &lt; b &amp; <span translate="no">⟦0⟧</span>');
assert.strictEqual(fromDeeplHtml('가 &lt; 나 &amp; <span translate="no">⟦0⟧</span>'), '가 < 나 & ⟦0⟧');

console.log('ok');
