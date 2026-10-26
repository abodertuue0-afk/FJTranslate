// مترجم نوسة — منطق الواجهة.
import { settings, saveSettings, listHistory, upsertHistory, getHistory, setFavorite, removeHistory, clearHistory, clearFavorites } from './storage.js';
import { detectLanguage, LANGS, other } from './detect.js';
import * as tts from './tts.js';
import { downloadModel, translateText, getModelStatus, deleteModel, explainError, engineMode } from './translator.js';
import { importFile, explainImportError, MAX_CHARS } from './importer.js';
import { prepareOffline as prepareOcr, isPrepared as ocrPrepared } from './ocr.js';
import { PHRASES, PHRASE_CATEGORIES } from './data/phrases.js';
import { LEGAL_TERMS, LEGAL_CATEGORIES } from './data/legal.js';

const APP_VERSION = '1.0.0';
const MODEL_INFO = {
  'en-ar': { label: 'الإنجليزية ← العربية', size: 'حوالي 110 ميغابايت' },
  'ar-en': { label: 'العربية ← الإنجليزية', size: 'حوالي 110 ميغابايت' },
};
const SAMPLES = {
  en: 'Hello, how are you today? I am studying law at the university.',
  ar: 'مرحباً، كيف حالك اليوم؟ أنا أدرس القانون في الجامعة.',
};

const $ = (id) => document.getElementById(id);

const state = {
  from: settings.from === 'ar' ? 'ar' : 'en',
  output: '',
  outputKind: null, // model | phrase | history
  busy: false,
  queued: false,
  currentId: null,
  models: {},
  modelsChecked: false,
  downloading: null,
  online: navigator.onLine,
  historyTab: 'all',
  phraseCat: PHRASE_CATEGORIES[0].id,
  legalCat: 'all',
};

let debounceTimer = null;
let historyTimer = null;
let toastTimer = null;

// ---------------------------------------------------------------- أدوات

function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

function toast(text, ms = 1800) {
  const t = $('toast');
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

function formatBytes(n) {
  if (!n) return '';
  if (n > 1024 * 1024 * 1024) return (n / 1024 / 1024 / 1024).toFixed(1) + ' غيغابايت';
  return Math.round(n / 1024 / 1024) + ' ميغابايت';
}

function relTime(ts) {
  const diff = (Date.now() - ts) / 1000;
  const rtf = new Intl.RelativeTimeFormat('ar', { numeric: 'auto' });
  if (diff < 60) return 'الآن';
  if (diff < 3600) return rtf.format(-Math.round(diff / 60), 'minute');
  if (diff < 86400) return rtf.format(-Math.round(diff / 3600), 'hour');
  return rtf.format(-Math.round(diff / 86400), 'day');
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = h('textarea', { style: 'position:fixed;opacity:0' });
    ta.value = text;
    document.body.append(ta);
    ta.select();
    try { document.execCommand('copy'); } catch { /* */ }
    ta.remove();
  }
  toast('تم النسخ 💗');
}

const direction = () => `${state.from}-${other(state.from)}`;
const isStandalone = () => window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

function speechOpts(lang) {
  return {
    rate: Number(settings.rate) || 1,
    voiceURI: lang === 'ar' ? settings.voiceAr : settings.voiceEn,
    onlyLocal: settings.onlyLocalVoices,
  };
}

function speakNow(text, lang, channel, toggleMode = true) {
  const err = toggleMode
    ? tts.toggle(text, lang, channel, speechOpts(lang))
    : tts.speak(text, lang, channel, speechOpts(lang));
  if (err) toast(err, 4200);
}

// ---------------------------------------------------------------- اللغات

function renderLanguages() {
  const src = LANGS[state.from];
  const dst = LANGS[other(state.from)];
  $('srcChip').replaceChildren(src.name, h('small', { text: src.native }));
  $('dstChip').replaceChildren(dst.name, h('small', { text: dst.native }));
  $('srcLabel').textContent = src.name;
  $('dstLabel').textContent = dst.name;
  const input = $('inputText');
  input.dir = src.dir;
  input.lang = src.code;
  input.placeholder = src.placeholder;
  const out = $('outputText');
  out.dir = dst.dir;
  out.lang = dst.code;
  renderOutput();
  renderModelNotice();
}

function setFrom(lang, { keepText = true } = {}) {
  if (lang === state.from) return;
  state.from = lang;
  settings.from = lang;
  saveSettings();
  if (!keepText) $('inputText').value = '';
  state.currentId = null;
  renderLanguages();
}

function swapLanguages() {
  tts.stop();
  const input = $('inputText');
  const oldInput = input.value;
  const oldOutput = state.output;
  state.from = other(state.from);
  settings.from = state.from;
  saveSettings();
  input.value = oldOutput;
  state.output = oldOutput ? oldInput : '';
  state.outputKind = oldOutput ? state.outputKind : null;
  state.currentId = null;
  $('swapBtn').classList.toggle('spin');
  renderLanguages();
  onInputChanged(false);
  if (input.value.trim() && state.outputKind === 'model') scheduleTranslate(50);
}

// ---------------------------------------------------------------- الإدخال والإخراج

function onInputChanged(fromUser = true) {
  const input = $('inputText');
  const text = input.value;
  $('charCount').textContent = `${text.length}/${MAX_CHARS}`;
  $('clearBtn').hidden = !text;
  input.classList.toggle('long', text.length > 180);
  $('speakSrc').disabled = !text.trim();
  if (!fromUser) return;

  if (!text.trim()) {
    state.output = '';
    state.outputKind = null;
    state.currentId = null;
    hideError();
    renderOutput();
    return;
  }
  state.outputKind = 'model';
  if (settings.autoTranslate) scheduleTranslate(700);
}

function renderOutput() {
  const out = $('outputText');
  const dst = LANGS[other(state.from)];
  if (state.output) {
    out.textContent = state.output;
    out.classList.remove('placeholder');
  } else {
    out.textContent = state.busy ? 'جارٍ الترجمة…' : dst.empty;
    out.classList.add('placeholder');
  }
  out.classList.toggle('busy', state.busy && !!state.output);
  out.classList.toggle('long', state.output.length > 180);
  $('busy').hidden = !state.busy;
  const hasOut = !!state.output;
  ['speakDst', 'copyBtn', 'shareBtn', 'favBtn'].forEach((id) => { $(id).disabled = !hasOut; });
  const rec = state.currentId ? getHistory(state.currentId) : null;
  $('favBtn').textContent = rec && rec.fav ? '♥' : '♡';
  $('favBtn').classList.toggle('on', !!(rec && rec.fav));
  const tag = $('sourceTag');
  if (state.output && state.outputKind === 'phrase') {
    tag.hidden = false;
    tag.textContent = '✓ ترجمة جاهزة من قائمة العبارات/المصطلحات';
  } else {
    tag.hidden = true;
  }
  $('translateBtn').disabled = state.busy;
  $('translateBtn').textContent = state.busy ? 'جارٍ الترجمة…' : 'ترجمي 💗';
}

function showError(text) {
  const box = $('errorBox');
  box.textContent = text;
  box.hidden = false;
}

function hideError() {
  $('errorBox').hidden = true;
}

function scheduleTranslate(ms) {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => runTranslate(false), ms);
}

async function runTranslate(manual) {
  clearTimeout(debounceTimer);
  const text = $('inputText').value.trim();
  if (!text) return;

  if (settings.autoDetect) {
    const detected = detectLanguage(text);
    if (detected && detected !== state.from) setFrom(detected);
  }

  const key = direction();
  if (!state.models[key]) {
    renderModelNotice();
    if (manual) {
      if (state.online) startDownload(key);
      else showError('نموذج ' + MODEL_INFO[key].label + ' غير منزّل بعد. اتصلي بالإنترنت مرة واحدة لتنزيله.');
    }
    return;
  }

  if (state.busy) {
    state.queued = true;
    return;
  }

  state.busy = true;
  state.outputKind = 'model';
  hideError();
  renderOutput();
  try {
    const result = await translateText(key, text);
    const current = $('inputText').value.trim();
    if (current === text && direction() === key) {
      state.output = result;
      renderOutput();
      scheduleHistorySave();
    }
  } catch (err) {
    showError(explainError(err, state.online));
  } finally {
    state.busy = false;
    renderOutput();
    if (state.queued) {
      state.queued = false;
      const latest = $('inputText').value.trim();
      if (latest && latest !== text) runTranslate(false);
    }
  }
}

// ---------------------------------------------------------------- السجل

function scheduleHistorySave() {
  clearTimeout(historyTimer);
  historyTimer = setTimeout(() => saveCurrent(false), 1500);
}

function saveCurrent(force) {
  clearTimeout(historyTimer);
  const src = $('inputText').value.trim();
  if (!src || !state.output || state.busy) return null;
  if (!settings.saveHistory && !force) return null;
  const existing = state.currentId ? getHistory(state.currentId) : null;
  const item = upsertHistory({
    id: existing ? existing.id : undefined,
    src,
    out: state.output,
    from: state.from,
    to: other(state.from),
    fav: existing ? existing.fav : false,
  });
  state.currentId = item.id;
  renderHistory();
  return item;
}

function loadIntoTranslator(src, out, from, kind, id = null) {
  tts.stop();
  clearTimeout(debounceTimer);
  if (from !== state.from) {
    state.from = from;
    settings.from = from;
    saveSettings();
  }
  $('inputText').value = src;
  state.output = out;
  state.outputKind = kind;
  state.currentId = id;
  hideError();
  renderLanguages();
  onInputChanged(false);
  showScreen('translate');
}

// ---------------------------------------------------------------- النماذج

async function refreshModelStatus() {
  try {
    state.models = await getModelStatus();
  } catch {
    state.models = {};
  }
  state.modelsChecked = true;
  renderModelNotice();
  renderModelRows();
}

function renderModelNotice() {
  const key = direction();
  const notice = $('modelNotice');
  if (!state.modelsChecked || state.models[key]) {
    notice.hidden = !state.downloading;
    if (!state.downloading) return;
  }
  notice.hidden = false;
  const info = MODEL_INFO[key];
  const text = $('modelNoticeText');
  const btn = $('modelNoticeBtn');
  if (state.downloading) {
    text.textContent = `جارٍ تنزيل نموذج ${MODEL_INFO[state.downloading].label}… أبقي التطبيق مفتوحاً.`;
    btn.hidden = true;
    $('dlProgressWrap').hidden = false;
  } else {
    text.replaceChildren(
      h('strong', { text: `🎀 نموذج ${info.label} غير منزّل بعد` }),
      h('div', { class: 'small', text: state.online
        ? `نزّليه مرة واحدة (${info.size})، وبعدها تعمل الترجمة دون إنترنت.`
        : 'اتصلي بالإنترنت مرة واحدة لتنزيله، وبعدها تعمل الترجمة دون إنترنت.' }),
    );
    btn.hidden = false;
    btn.disabled = !state.online;
    $('dlProgressWrap').hidden = true;
  }
}

async function startDownload(key) {
  if (state.downloading) return;
  state.downloading = key;
  const files = new Map();
  const bar = $('dlProgress');
  const label = $('dlProgressText');
  bar.style.width = '0%';
  label.textContent = 'جارٍ البدء…';
  renderModelNotice();
  renderModelRows();
  try {
    if (navigator.storage && navigator.storage.estimate) {
      const est = await navigator.storage.estimate();
      if (est.quota && est.usage !== undefined && est.quota - est.usage < 150 * 1024 * 1024) {
        throw new Error('QuotaExceeded');
      }
    }
    await downloadModel(key, (p) => {
      if (p.status === 'progress' && p.file && p.total) {
        files.set(p.file, { loaded: p.loaded || 0, total: p.total });
      } else if (p.status === 'done' && p.file && files.has(p.file)) {
        const f = files.get(p.file);
        f.loaded = f.total;
      }
      let loaded = 0;
      let total = 0;
      files.forEach((f) => { loaded += f.loaded; total += f.total; });
      if (total) {
        const pct = Math.min(100, Math.round((loaded / total) * 100));
        bar.style.width = pct + '%';
        label.textContent = `${pct}% — ${formatBytes(loaded) || '0 ميغابايت'} من ${formatBytes(total)}`;
        const rowLabel = document.querySelector(`[data-progress="${key}"]`);
        if (rowLabel) rowLabel.textContent = `${pct}%`;
      }
      if (p.status === 'ready') label.textContent = 'تجهيز النموذج…';
    });
    if (navigator.storage && navigator.storage.persist) {
      try { await navigator.storage.persist(); } catch { /* */ }
    }
    toast('تم تنزيل النموذج ✓ الترجمة تعمل الآن دون إنترنت', 3000);
  } catch (err) {
    showError(explainError(err, state.online));
  } finally {
    state.downloading = null;
    await refreshModelStatus();
    renderStorage();
    const text = $('inputText').value.trim();
    if (text && state.models[direction()]) runTranslate(false);
  }
}

function renderModelRows() {
  const wrap = $('modelRows');
  wrap.replaceChildren(...Object.keys(MODEL_INFO).map((key) => {
    const ready = !!state.models[key];
    const bytes = state.models._bytes ? state.models._bytes[key] : 0;
    const dl = state.downloading === key;
    return h('div', { class: 'model-row' },
      h('div', { class: 'row' },
        h('strong', { text: MODEL_INFO[key].label }),
        h('span', { class: 'state ' + (ready ? 'ok' : 'no'), 'data-progress': key,
          text: dl ? 'جارٍ التنزيل…' : ready ? `منزّل ✓ ${bytes ? '(' + formatBytes(bytes) + ')' : ''}` : `غير منزّل (${MODEL_INFO[key].size})` }),
      ),
      h('div', { class: 'btns' },
        !ready && h('button', { class: 'btn primary small', type: 'button', disabled: !!state.downloading || !state.online,
          onclick: () => startDownload(key), text: 'تنزيل' }),
        ready && h('button', { class: 'btn ghost danger small', type: 'button',
          onclick: async () => {
            if (!confirm('حذف نموذج ' + MODEL_INFO[key].label + ' من الجهاز؟')) return;
            await deleteModel(key);
            await refreshModelStatus();
            renderStorage();
          }, text: 'حذف' }),
      ),
    );
  }));
  if (!state.online && !Object.keys(MODEL_INFO).every((k) => state.models[k])) {
    wrap.append(h('p', { class: 'small muted', text: 'التنزيل يحتاج اتصالاً بالإنترنت مرة واحدة فقط.' }));
  }
}

async function renderStorage() {
  const info = $('storageInfo');
  if (!navigator.storage || !navigator.storage.estimate) { info.textContent = ''; return; }
  try {
    const est = await navigator.storage.estimate();
    const persisted = navigator.storage.persisted ? await navigator.storage.persisted() : false;
    info.textContent = `المستخدم على الجهاز: ${formatBytes(est.usage) || 'أقل من 1 ميغابايت'}` +
      (est.quota ? ` · المتاح للتطبيق: ${formatBytes(est.quota)}` : '') +
      (persisted ? ' · التخزين محمي من الحذف التلقائي ✓' : '');
  } catch {
    info.textContent = '';
  }
}

// ---------------------------------------------------------------- الصوت

function renderSpeechState(s = tts.getState()) {
  const map = { src: ['speakSrc', 'srcSpeechCtl'], dst: ['speakDst', 'dstSpeechCtl'] };
  for (const [ch, [btnId, ctlId]] of Object.entries(map)) {
    const active = s.channel === ch;
    $(btnId).classList.toggle('on', active);
    $(btnId).textContent = active ? '■' : '🔊';
    $(ctlId).hidden = !active;
    const pause = $(ctlId).querySelector('[data-act="pause"]');
    pause.textContent = s.paused ? '▶︎ متابعة' : '⏸ إيقاف مؤقت';
  }
}

function fillVoiceSelect(selectId, lang, savedKey) {
  const select = $(selectId);
  const list = tts.voicesFor(lang, settings.onlyLocalVoices);
  if (!list.length) {
    select.replaceChildren(h('option', { value: '', text: tts.supported ? 'لا يوجد صوت مثبت — راجعي الطريقة أدناه' : 'النطق غير مدعوم' }));
    select.disabled = true;
    return;
  }
  select.disabled = false;
  const chosen = tts.pickVoice(lang, settings[savedKey], settings.onlyLocalVoices);
  select.replaceChildren(...list.map((v) => h('option', {
    value: v.voiceURI,
    selected: chosen && v.voiceURI === chosen.voiceURI,
    text: `${v.name} (${v.lang})${v.localService === false ? ' — يحتاج إنترنت' : ''}`,
  })));
}

function renderVoices() {
  fillVoiceSelect('voiceAr', 'ar', 'voiceAr');
  fillVoiceSelect('voiceEn', 'en', 'voiceEn');
}

// ---------------------------------------------------------------- العبارات والمصطلحات

function pairItem(entry, { note } = {}) {
  return h('div', { class: 'item' },
    h('p', { class: 'en', text: entry.en }),
    h('p', { class: 'ar', text: entry.ar }),
    note && h('div', { class: 'note', text: note }),
    h('div', { class: 'actions' },
      h('button', { type: 'button', text: '🔊 EN', onclick: () => speakNow(entry.en, 'en', 'list-en-' + entry.en, false) }),
      h('button', { type: 'button', text: '🔊 عربي', onclick: () => speakNow(entry.ar, 'ar', 'list-ar-' + entry.en, false) }),
      h('button', { type: 'button', text: 'استخدام في المترجم', onclick: () => loadIntoTranslator(entry.en, entry.ar, 'en', 'phrase') }),
      h('button', { type: 'button', text: 'نسخ', onclick: () => copyText(`${entry.en}\n${entry.ar}`) }),
    ),
  );
}

function renderPhrases() {
  $('phraseTabs').replaceChildren(...PHRASE_CATEGORIES.map((c) => h('button', {
    class: 'seg-btn' + (c.id === state.phraseCat ? ' active' : ''),
    type: 'button',
    text: `${c.icon} ${c.title}`,
    onclick: () => { state.phraseCat = c.id; renderPhrases(); },
  })));
  $('phraseList').replaceChildren(...PHRASES.filter((p) => p.cat === state.phraseCat).map((p) => pairItem(p)));
}

function renderLegal() {
  const tabs = [{ id: 'all', title: 'الكل' }, ...LEGAL_CATEGORIES];
  $('legalTabs').replaceChildren(...tabs.map((c) => h('button', {
    class: 'seg-btn' + (c.id === state.legalCat ? ' active' : ''),
    type: 'button',
    text: c.title,
    onclick: () => { state.legalCat = c.id; renderLegal(); },
  })));
  const q = $('legalSearch').value.trim().toLowerCase();
  const items = LEGAL_TERMS.filter((t) =>
    (state.legalCat === 'all' || t.cat === state.legalCat) &&
    (!q || t.en.toLowerCase().includes(q) || t.ar.includes(q) || (t.note || '').includes(q)));
  $('legalList').replaceChildren(...(items.length
    ? items.map((t) => pairItem(t, { note: t.note }))
    : [h('div', { class: 'empty' }, h('span', { class: 'big-emoji', text: '🔎' }), 'لا توجد نتائج. جرّبي المترجم لترجمة الكلمة.')]));
}

// ---------------------------------------------------------------- السجل والمفضلة

function renderHistory() {
  const q = ($('historySearch').value || '').trim().toLowerCase();
  const fav = state.historyTab === 'fav';
  const items = listHistory().filter((h0) => (!fav || h0.fav) &&
    (!q || h0.src.toLowerCase().includes(q) || h0.out.toLowerCase().includes(q)));
  const list = $('historyList');
  $('clearHistoryBtn').textContent = fav ? 'إزالة كل المفضلة' : 'مسح السجل (تبقى المفضلة)';
  $('clearHistoryBtn').hidden = !listHistory().some((x) => !fav || x.fav);
  if (!items.length) {
    list.replaceChildren(h('div', { class: 'empty' },
      h('span', { class: 'big-emoji', text: fav ? '💗' : '📒' }),
      q ? 'لا توجد نتائج.' : fav ? 'اضغطي ♡ بجانب أي ترجمة لحفظها هنا.' : 'ستظهر ترجماتك هنا، وتبقى على جهازك فقط.'));
    return;
  }
  list.replaceChildren(...items.map((it) => h('div', { class: 'item' },
    h('div', { class: 'meta' },
      h('span', { text: `${LANGS[it.from].name} ← ${LANGS[it.to].name}${it.fav ? ' ♥' : ''}` }),
      h('span', { text: relTime(it.ts) }),
    ),
    h('p', { class: 'clamp', dir: LANGS[it.from].dir, text: it.src }),
    h('p', { class: 'clamp ar-like', dir: LANGS[it.to].dir, style: 'color:var(--pink-deep);font-weight:700', text: it.out }),
    h('div', { class: 'actions' },
      h('button', { type: 'button', text: 'فتح', onclick: () => loadIntoTranslator(it.src, it.out, it.from, 'history', it.id) }),
      h('button', { type: 'button', text: '🔊', 'aria-label': 'استماع', onclick: () => speakNow(it.out, it.to, 'hist-' + it.id, false) }),
      h('button', { type: 'button', text: it.fav ? '♥ إزالة' : '♡ مفضلة', onclick: () => { setFavorite(it.id, !it.fav); renderHistory(); renderOutput(); } }),
      h('button', { type: 'button', text: 'نسخ', onclick: () => copyText(it.out) }),
      h('button', { type: 'button', text: 'حذف', onclick: () => {
        removeHistory(it.id);
        if (state.currentId === it.id) state.currentId = null;
        renderHistory();
        renderOutput();
      } }),
    ),
  )));
}

// ---------------------------------------------------------------- OCR والاستيراد

async function handleFile(file, viaOcrButton) {
  if (!file) return;
  const status = $('importStatus');
  status.hidden = false;
  status.textContent = viaOcrButton ? 'قراءة النص من الصورة…' : 'قراءة الملف…';
  hideError();
  try {
    const { text, truncated } = await importFile(file, state.from, (s) => { status.textContent = s; });
    if (!text) {
      showError('لم يُعثر على نص في الملف. للصور: صوّري النص بوضوح وبإضاءة جيدة.');
      return;
    }
    $('inputText').value = text;
    state.currentId = null;
    onInputChanged(true);
    if (truncated) toast(`أُخذت أول ${MAX_CHARS} حرف فقط`, 3000);
    if (!settings.autoTranslate) runTranslate(true);
  } catch (err) {
    showError(explainImportError(err));
  } finally {
    status.hidden = true;
  }
}

async function renderOcrStatus() {
  const el = $('ocrStatus');
  try {
    const ok = await ocrPrepared();
    el.textContent = ok ? 'جاهز دون إنترنت ✓' : 'غير مُجهّز';
    el.className = 'state ' + (ok ? 'ok' : 'no');
  } catch {
    el.textContent = 'غير مُجهّز';
  }
}

// ---------------------------------------------------------------- الاختبار دون إنترنت

async function runSelfTest() {
  const out = $('selfTestResults');
  const btn = $('selfTestBtn');
  btn.disabled = true;
  out.replaceChildren(h('p', { class: 'small muted', text: 'جارٍ الاختبار…' }));
  await refreshModelStatus();
  const offline = !navigator.onLine;
  const results = [];
  for (const from of ['en', 'ar']) {
    const key = `${from}-${other(from)}`;
    const title = MODEL_INFO[key].label;
    if (!state.models[key]) {
      results.push(h('div', { class: 'notice error test-result', text: `${title}: النموذج غير منزّل.` }));
      continue;
    }
    try {
      const started = performance.now();
      const translated = await translateText(key, SAMPLES[from]);
      const secs = ((performance.now() - started) / 1000).toFixed(1);
      const to = other(from);
      results.push(h('div', { class: 'notice ok test-result' },
        h('strong', { text: `✓ ${title} — ${offline ? 'دون إنترنت' : 'مع إنترنت'} (${secs} ث)` }),
        h('div', { class: LANGS[from].dir + ' small', text: SAMPLES[from] }),
        h('div', { class: LANGS[to].dir, style: 'font-weight:700;margin:4px 0', text: translated }),
        h('button', { class: 'btn small', type: 'button', text: '🔊 استماع',
          onclick: () => speakNow(translated, to, 'test-' + key, false) }),
      ));
    } catch (err) {
      results.push(h('div', { class: 'notice error test-result', text: `${title}: ${explainError(err, !offline)}` }));
    }
  }
  const allOk = results.every((r) => r.classList.contains('ok'));
  if (allOk) {
    results.push(h('div', { class: 'notice ' + (offline ? 'ok' : 'lavender'),
      text: offline
        ? '🎀 الترجمة تعمل دون إنترنت في الاتجاهين. جرّبي أزرار الاستماع للتأكد من الأصوات.'
        : 'نجحت الترجمة، لكن الجهاز متصل. فعّلي وضع الطيران وأعيدي الاختبار.' }));
  }
  const arVoice = tts.voicesFor('ar', true).length;
  const enVoice = tts.voicesFor('en', true).length;
  results.push(h('p', { class: 'small muted',
    text: `الأصوات المحلية: العربية ${arVoice ? '✓ (' + arVoice + ')' : '✗ غير مثبت'} · الإنجليزية ${enVoice ? '✓ (' + enVoice + ')' : '✗ غير مثبت'}` }));
  out.replaceChildren(...results);
  btn.disabled = false;
}

// ---------------------------------------------------------------- المظهر والتنقل

function applyTheme() {
  const t = settings.theme;
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
  document.querySelectorAll('#themeSeg .seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.theme === t));
}

function showScreen(name) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === 'screen-' + name));
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.screen === name));
  window.scrollTo({ top: 0 });
  if (name === 'history') renderHistory();
  if (name === 'settings') {
    tts.refreshVoices();
    renderVoices();
    renderStorage();
    renderOcrStatus();
    refreshModelStatus();
  }
}

function renderNetwork() {
  state.online = navigator.onLine;
  const chip = $('netChip');
  chip.hidden = state.online;
  chip.textContent = 'دون اتصال ✈️';
  chip.classList.add('offline');
  renderModelNotice();
  if (state.modelsChecked) renderModelRows();
}

// ---------------------------------------------------------------- ربط الأحداث

function bindEvents() {
  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => showScreen(t.dataset.screen)));

  $('swapBtn').addEventListener('click', swapLanguages);
  $('srcChip').addEventListener('click', () => $('inputText').focus());
  $('dstChip').addEventListener('click', swapLanguages);

  const input = $('inputText');
  input.addEventListener('input', () => { state.currentId = null; onInputChanged(true); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) runTranslate(true);
  });

  $('clearBtn').addEventListener('click', () => {
    tts.stop();
    input.value = '';
    onInputChanged(true);
    input.focus();
  });

  $('translateBtn').addEventListener('click', () => {
    input.blur();
    runTranslate(true);
  });

  $('pasteBtn').addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text) { toast('الحافظة فارغة'); return; }
      const start = input.selectionStart ?? input.value.length;
      const end = input.selectionEnd ?? input.value.length;
      input.value = (input.value.slice(0, start) + text + input.value.slice(end)).slice(0, MAX_CHARS);
      state.currentId = null;
      onInputChanged(true);
    } catch {
      toast('اضغطي مطولاً داخل المربع واختاري «لصق»', 3000);
      input.focus();
    }
  });

  $('speakSrc').addEventListener('click', () => speakNow(input.value, state.from, 'src'));
  $('speakDst').addEventListener('click', () => speakNow(state.output, other(state.from), 'dst'));
  document.querySelectorAll('.speech-ctl .pill').forEach((b) => b.addEventListener('click', () => {
    const ch = b.dataset.ch;
    if (b.dataset.act === 'pause') tts.pauseResume();
    else if (ch === 'src') speakNow(input.value, state.from, 'src', false);
    else speakNow(state.output, other(state.from), 'dst', false);
  }));

  $('rateQuick').addEventListener('change', (e) => {
    settings.rate = Number(e.target.value);
    saveSettings();
    syncRate();
  });

  $('copyBtn').addEventListener('click', () => {
    if (!state.output) return;
    copyText(state.output);
    saveCurrent(false);
  });

  $('shareBtn').addEventListener('click', async () => {
    if (!state.output) return;
    if (navigator.share) {
      try { await navigator.share({ text: state.output }); } catch { /* أُلغيت */ }
    } else {
      copyText(state.output);
    }
  });

  $('favBtn').addEventListener('click', () => {
    const item = saveCurrent(true);
    if (!item) return;
    setFavorite(item.id, !item.fav);
    toast(item.fav ? 'أُضيفت إلى المفضلة ♥' : 'أُزيلت من المفضلة');
    renderOutput();
    renderHistory();
  });

  $('ocrBtn').addEventListener('click', () => $('ocrInput').click());
  $('importBtn').addEventListener('click', () => $('fileInput').click());
  $('ocrInput').addEventListener('change', (e) => { handleFile(e.target.files[0], true); e.target.value = ''; });
  $('fileInput').addEventListener('change', (e) => { handleFile(e.target.files[0], false); e.target.value = ''; });

  $('modelNoticeBtn').addEventListener('click', () => startDownload(direction()));

  $('legalSearch').addEventListener('input', renderLegal);
  $('historySearch').addEventListener('input', renderHistory);
  document.querySelectorAll('#historyTabs .seg-btn').forEach((b) => b.addEventListener('click', () => {
    state.historyTab = b.dataset.tab;
    document.querySelectorAll('#historyTabs .seg-btn').forEach((x) => x.classList.toggle('active', x === b));
    renderHistory();
  }));
  $('clearHistoryBtn').addEventListener('click', () => {
    if (state.historyTab === 'fav') {
      if (!confirm('إزالة كل الترجمات من المفضلة؟')) return;
      clearFavorites();
    } else {
      if (!confirm('مسح السجل؟ ستبقى المفضلة محفوظة.')) return;
      clearHistory();
      if (state.currentId && !getHistory(state.currentId)) state.currentId = null;
    }
    renderHistory();
    renderOutput();
  });

  // الإعدادات
  $('rateSlider').addEventListener('input', (e) => {
    settings.rate = Number(e.target.value);
    saveSettings();
    syncRate();
  });
  $('voiceAr').addEventListener('change', (e) => { settings.voiceAr = e.target.value; saveSettings(); });
  $('voiceEn').addEventListener('change', (e) => { settings.voiceEn = e.target.value; saveSettings(); });
  $('testAr').addEventListener('click', () => speakNow('مرحباً، أنا مترجم نوسة. صوتي يعمل من جهازك دون إنترنت.', 'ar', 'test-ar', false));
  $('testEn').addEventListener('click', () => speakNow('Hello! I am Nousa Translator, speaking from your device without internet.', 'en', 'test-en', false));
  $('onlyLocal').addEventListener('change', (e) => { settings.onlyLocalVoices = e.target.checked; saveSettings(); renderVoices(); });

  for (const key of ['autoTranslate', 'autoDetect', 'saveHistory']) {
    $(key).checked = !!settings[key];
    $(key).addEventListener('change', (e) => { settings[key] = e.target.checked; saveSettings(); });
  }
  $('onlyLocal').checked = !!settings.onlyLocalVoices;

  document.querySelectorAll('#themeSeg .seg-btn').forEach((b) => b.addEventListener('click', () => {
    settings.theme = b.dataset.theme;
    saveSettings();
    applyTheme();
  }));

  $('ocrPrepareBtn').addEventListener('click', async () => {
    const btn = $('ocrPrepareBtn');
    const txt = $('ocrPrepareText');
    if (!navigator.onLine) { txt.textContent = 'يحتاج التجهيز اتصالاً بالإنترنت مرة واحدة.'; return; }
    btn.disabled = true;
    try {
      await prepareOcr((s) => { txt.textContent = s; });
      txt.textContent = 'قارئ الصور جاهز ✓';
    } catch (err) {
      txt.textContent = explainImportError(err);
    } finally {
      btn.disabled = false;
      renderOcrStatus();
      renderStorage();
    }
  });

  $('selfTestBtn').addEventListener('click', runSelfTest);

  window.addEventListener('online', renderNetwork);
  window.addEventListener('offline', renderNetwork);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') saveCurrent(false);
    else { tts.refreshVoices(); renderVoices(); }
  });

  tts.onChange((s) => {
    renderSpeechState(s);
    renderVoices();
  });
}

function syncRate() {
  const r = Number(settings.rate) || 1;
  $('rateSlider').value = r;
  $('rateLabel').textContent = `${r}×`;
  const quick = $('rateQuick');
  const opt = [...quick.options].find((o) => Number(o.value) === r);
  if (!opt) quick.append(h('option', { value: String(r), text: `${r}×` }));
  quick.value = String(r);
}

// ---------------------------------------------------------------- Service Worker

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  // نعرض رسالة التحديث فقط إذا كانت هناك نسخة سابقة تعمل (وليس عند أول تثبيت).
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js').then((reg) => {
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing;
      if (!nw) return;
      nw.addEventListener('statechange', () => {
        if (nw.state === 'activated' && hadController) {
          toast('تم تحديث التطبيق ✨ أغلقيه وافتحيه لتطبيق التحديث', 4500);
        }
      });
    });
  }).catch(() => { /* التطبيق يعمل، لكن دون تخزين للعمل دون إنترنت */ });
}

// ---------------------------------------------------------------- البدء

function init() {
  applyTheme();
  bindEvents();
  syncRate();
  renderLanguages();
  onInputChanged(false);
  renderPhrases();
  renderLegal();
  renderHistory();
  renderSpeechState();
  renderNetwork();
  $('installCard').hidden = !(isIOS() && !isStandalone());
  if (!tts.supported) toast('هذا المتصفح لا يدعم النطق', 3000);
  $('versionInfo').textContent = `الإصدار ${APP_VERSION}`;
  registerServiceWorker();
  refreshModelStatus().then(() => {
    $('versionInfo').textContent = `الإصدار ${APP_VERSION} · المحرك: ${engineMode() === 'worker' ? 'Web Worker' : 'الصفحة'}`;
  });
  renderStorage();
}

init();
