importScripts('lib.js');

// API keys come from .env in the extension folder (preferred) or the popup (chrome.storage.local),
// and are only read here, never in the content script or the popup.
chrome.runtime.onMessage.addListener((msg, _sender, send) => {
  if (msg.type === 'envStatus') { // tell the popup which settings .env provides, never the values
    env().then((e) => send({ deeplKey: !!e.DEEPL_API_KEY, claudeKey: !!e.ANTHROPIC_API_KEY, claudeModel: !!e.CLAUDE_MODEL }));
    return true;
  }
  if (msg.type !== 'translate') return;
  run(msg.engine, msg.texts).then((result) => send({ result }), (e) => send({ error: e.message || String(e) }));
  return true; // async response
});

chrome.commands.onCommand.addListener(async (cmd, tab) => {
  if (cmd !== 'toggle-translate' || !tab?.id) return;
  const { engine = 'chrome', mode = 'bilingual' } = await chrome.storage.local.get(['engine', 'mode']);
  chrome.tabs.sendMessage(tab.id, { type: 'toggle', engine, mode }).catch(() => {}); // chrome:// pages etc.
});

// .env is a gitignored file next to manifest.json (unpacked install only); missing file = {}.
async function env() {
  const r = await fetch(chrome.runtime.getURL('.env')).catch(() => null);
  return r?.ok ? IAT.parseEnv(await r.text()) : {};
}

async function run(engine, texts) {
  const s = await chrome.storage.local.get(['deeplKey', 'claudeKey', 'claudeModel']);
  const e = await env();
  if (engine === 'deepl') return deepl(texts, e.DEEPL_API_KEY || s.deeplKey);
  if (engine === 'claude') {
    return claude(texts, e.ANTHROPIC_API_KEY || s.claudeKey, e.CLAUDE_MODEL || s.claudeModel || 'claude-opus-5-5');
  }
  throw new Error('unknown engine ' + engine);
}

async function deepl(texts, key) {
  if (!key) throw new Error('DeepL API 키가 없습니다 (.env 의 DEEPL_API_KEY 또는 팝업에서 입력)');
  const host = key.endsWith(':fx') ? 'https://api-free.deepl.com' : 'https://api.deepl.com';
  const r = await fetch(host + '/v2/translate', {
    method: 'POST',
    headers: { Authorization: 'DeepL-Auth-Key ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: texts.map(IAT.toDeeplHtml), target_lang: 'KO', tag_handling: 'html' }),
  });
  if (!r.ok) throw new Error(`DeepL ${r.status}: ${await r.text()}`);
  return (await r.json()).translations.map((t) => IAT.fromDeeplHtml(t.text));
}

const SYSTEM = `You translate web page text from English to natural, fluent Korean.
Input: a JSON array of strings, each one paragraph-like block from the same page.
Rules:
- Keep marker tokens exactly as written. A lone ⟦n⟧ stands for inline code or math: place it where it fits in the Korean sentence.
- A pair ⟦n⟧…⟦/n⟧ wraps formatted text (a link, bold, etc.): wrap the Korean words that correspond to it with the same pair.
- Leave code identifiers, file paths, URLs, commands and product names untranslated.
- Return {"t": [...]} with exactly one Korean string per input string, same order.`;

async function claude(texts, key, model) {
  if (!key) throw new Error('Claude API 키가 없습니다 (.env 의 ANTHROPIC_API_KEY 또는 팝업에서 입력)');
  const headers = {
    'x-api-key': key,
    'anthropic-version': '2026-10-21',
    'content-type': 'application/json',
    'anthropic-dangerous-direct-browser-access': 'true',
  };
  const body = {
    model,
    max_tokens: 16000,
    system: SYSTEM,
    output_config: {
      effort: 'low',
      format: {
        type: 'json_schema',
        schema: {
          type: 'object',
          properties: { t: { type: 'array', items: { type: 'string' } } },
          required: ['t'],
          additionalProperties: false,
        },
      },
    },
    messages: [{ role: 'user', content: JSON.stringify(texts) }],
  };
  // Server-side refusal fallback; Haiku has none, so only for the larger models.
  if (!/haiku/.test(model)) {
    headers['anthropic-beta'] = 'server-side-fallback-2026-07-01';
    body.fallbacks = 'default';
  }
  const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`Claude ${r.status}: ${await r.text()}`);
  const msg = await r.json();
  if (msg.stop_reason === 'refusal') throw new Error('Claude가 번역을 거절했습니다');
  if (msg.stop_reason === 'max_tokens') throw new Error('Claude 응답이 max_tokens에서 잘렸습니다');
  const text = msg.content.find((b) => b.type === 'text')?.text;
  const out = JSON.parse(text).t;
  if (out.length !== texts.length) throw new Error(`Claude 결과 개수 불일치 ${out.length}/${texts.length}`);
  return out;
}
