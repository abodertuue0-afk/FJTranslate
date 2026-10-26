// النطق عبر Web Speech API (speechSynthesis) — يستخدم أصوات الآيفون المثبتة على الجهاز.
// voice.localService = true تعني أن الصوت يعمل محلياً دون إنترنت.

const synth = typeof window !== 'undefined' ? window.speechSynthesis : null;

const QUALITY_HINT = /(enhanced|premium|neural|محسّن|محسن|ممتاز)/i;
const PREFERRED = { en: ['en-US', 'en-GB'], ar: ['ar-SA', 'ar-001'] };

let voices = [];
let listeners = new Set();
let state = { channel: null, paused: false };
let queue = [];
let token = 0;

export const supported = !!(synth && typeof SpeechSynthesisUtterance !== 'undefined');

function notify() {
  listeners.forEach((fn) => fn({ ...state }));
}

function loadVoices() {
  if (!supported) return;
  const list = synth.getVoices() || [];
  if (list.length) {
    voices = list;
    notify();
  }
}

if (supported) {
  loadVoices();
  if (typeof synth.addEventListener === 'function') synth.addEventListener('voiceschanged', loadVoices);
  else synth.onvoiceschanged = loadVoices;
  // iOS أحياناً لا يطلق voiceschanged؛ نعيد المحاولة بضع مرات.
  let tries = 0;
  const poll = setInterval(() => {
    loadVoices();
    if (voices.length || ++tries > 20) clearInterval(poll);
  }, 250);
}

export function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function refreshVoices() {
  loadVoices();
  return voices;
}

function normLang(v) {
  return (v.lang || '').replace('_', '-').toLowerCase();
}

/** الأصوات المتاحة للغة، مرتبة: المحلية أولاً، ثم الأعلى جودة، ثم اللهجة المفضلة. */
export function voicesFor(lang, onlyLocal = true) {
  const list = voices.filter((v) => normLang(v).startsWith(lang) && (!onlyLocal || v.localService !== false));
  const pref = PREFERRED[lang] || [];
  return list.sort((a, b) => {
    if (a.localService !== b.localService) return a.localService ? -1 : 1;
    const qa = QUALITY_HINT.test(a.name) ? 1 : 0;
    const qb = QUALITY_HINT.test(b.name) ? 1 : 0;
    if (qa !== qb) return qb - qa;
    const pa = pref.indexOf(a.lang); const pb = pref.indexOf(b.lang);
    return (pa === -1 ? 99 : pa) - (pb === -1 ? 99 : pb) || a.name.localeCompare(b.name);
  });
}

export function pickVoice(lang, savedURI, onlyLocal = true) {
  const list = voicesFor(lang, onlyLocal);
  return list.find((v) => v.voiceURI === savedURI) || list[0] || null;
}

/** تقسيم النص الطويل إلى مقاطع (iOS يقطع النصوص الطويلة أحياناً). */
function chunks(text) {
  const parts = text.replace(/\s+/g, ' ').match(/[^.!?؟،,؛;\n]+[.!?؟،,؛;]*\s*/g) || [text];
  const out = [];
  let buf = '';
  for (const p of parts) {
    if ((buf + p).length > 180 && buf) { out.push(buf.trim()); buf = ''; }
    buf += p;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

export function isSpeaking(channel) {
  return state.channel === channel;
}

export function getState() {
  return { ...state };
}

/**
 * نطق نص. يعيد null عند النجاح، أو رسالة خطأ عربية.
 */
export function speak(text, lang, channel, { rate = 1, voiceURI = '', onlyLocal = true } = {}) {
  if (!supported) return 'المتصفح لا يدعم النطق.';
  const value = (text || '').trim();
  if (!value) return null;
  loadVoices();
  const voice = pickVoice(lang, voiceURI, onlyLocal);
  if (!voice && voices.length) {
    return lang === 'ar'
      ? 'لا يوجد صوت عربي مثبت على الجهاز. راجعي «تنزيل الأصوات» في الإعدادات.'
      : 'لا يوجد صوت إنجليزي مثبت على الجهاز. راجعي «تنزيل الأصوات» في الإعدادات.';
  }

  stop(false);
  const myToken = ++token;
  queue = chunks(value);
  state = { channel, paused: false };
  notify();

  const speakNext = () => {
    if (myToken !== token) return;
    const part = queue.shift();
    if (!part) {
      state = { channel: null, paused: false };
      notify();
      return;
    }
    const u = new SpeechSynthesisUtterance(part);
    if (voice) u.voice = voice;
    u.lang = voice ? voice.lang : (lang === 'ar' ? 'ar-SA' : 'en-US');
    u.rate = Math.min(1.5, Math.max(0.5, rate));
    u.pitch = 1;
    u.volume = 1;
    u.onend = speakNext;
    u.onerror = (e) => {
      if (myToken !== token) return;
      if (e && (e.error === 'interrupted' || e.error === 'canceled')) return;
      state = { channel: null, paused: false };
      notify();
    };
    synth.speak(u);
  };

  // iOS: مهلة قصيرة بعد cancel لتجنب ضياع أول مقطع.
  setTimeout(speakNext, 60);
  return null;
}

export function toggle(text, lang, channel, opts) {
  if (state.channel === channel) {
    stop();
    return null;
  }
  return speak(text, lang, channel, opts);
}

export function pauseResume() {
  if (!supported || !state.channel) return;
  if (state.paused) {
    synth.resume();
    state.paused = false;
  } else {
    synth.pause();
    state.paused = true;
  }
  notify();
}

export function stop(emit = true) {
  token++;
  queue = [];
  if (supported) synth.cancel();
  if (state.channel !== null || state.paused) {
    state = { channel: null, paused: false };
    if (emit) notify();
  }
}
