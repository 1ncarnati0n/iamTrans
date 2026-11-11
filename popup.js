const $ = (id) => document.getElementById(id);
const status = (t) => ($('status').textContent = t);
const DEFAULTS = { engine: 'chrome', mode: 'bilingual', deeplKey: '', claudeKey: '', claudeModel: 'claude-opus-5-5' };

let s;

async function tab() {
  const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
  return t;
}

async function send(msg) {
  try {
    await chrome.tabs.sendMessage((await tab()).id, msg);
    return true;
  } catch {
    status('이 페이지에서는 실행할 수 없습니다 (새로고침 후 재시도, chrome:// 페이지는 불가)');
    return false;
  }
}

function show() {
  $('deeplBox').hidden = s.engine !== 'deepl';
  $('claudeBox').hidden = s.engine !== 'claude';
}

// The on-device model download needs a user gesture, which only exists here (not in the page).
async function ensureChromeModel() {
  if (!('Translator' in self)) throw new Error('Chrome 138 이상 데스크톱이 필요합니다');
  const opts = { sourceLanguage: 'en', targetLanguage: 'ko' };
  const a = await Translator.availability(opts);
  if (a === 'unavailable') throw new Error('영→한 모델을 사용할 수 없습니다');
  if (a === 'available') return;
  status('번역 모델 다운로드 중…');
  await Translator.create({
    ...opts,
    monitor(m) { m.addEventListener('downloadprogress', (e) => status(`모델 다운로드 ${Math.round(e.loaded * 100)}%`)); },
  });
}

(async () => {
  s = { ...DEFAULTS, ...(await chrome.storage.local.get(Object.keys(DEFAULTS))) };
  document.querySelector(`[name=engine][value=${s.engine}]`).checked = true;
  document.querySelector(`[name=mode][value=${s.mode}]`).checked = true;
  for (const k of ['deeplKey', 'claudeKey', 'claudeModel']) $(k).value = s[k];
  show();

  document.addEventListener('change', (e) => {
    const { name, id, value } = e.target;
    const key = name || id;
    s[key] = value.trim();
    chrome.storage.local.set({ [key]: s[key] });
    show();
    if (key === 'mode') send({ type: 'mode', mode: s.mode });
  });

  $('go').onclick = async () => {
    try {
      if (s.engine === 'chrome') await ensureChromeModel();
      if (await send({ type: 'start', engine: s.engine, mode: s.mode })) status('번역 중 — 스크롤하면 보이는 부분부터 번역됩니다');
    } catch (e) {
      status(e.message);
    }
  };
  $('restore').onclick = async () => { if (await send({ type: 'restore' })) status('원문으로 복원'); };
})();
