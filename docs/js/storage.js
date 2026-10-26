// التخزين المحلي: الإعدادات + السجل + المفضلة (على الجهاز فقط).

const KEY_SETTINGS = 'nousa.settings.v1';
const KEY_HISTORY = 'nousa.history.v1';
const MAX_HISTORY = 300;

const DEFAULTS = {
  theme: 'system',      // system | light | dark
  rate: 1,              // سرعة النطق 0.5 – 1.5
  autoTranslate: true,
  autoDetect: true,
  saveHistory: true,
  voiceAr: '',
  voiceEn: '',
  from: 'en',
  onlyLocalVoices: true,
};

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export const settings = { ...DEFAULTS, ...read(KEY_SETTINGS, {}) };

export function saveSettings() {
  write(KEY_SETTINGS, settings);
}

let history = read(KEY_HISTORY, []);
if (!Array.isArray(history)) history = [];

function persistHistory() {
  // إذا امتلأ التخزين نحذف أقدم السجلات غير المفضلة ونعيد المحاولة.
  while (!write(KEY_HISTORY, history)) {
    const idx = history.map((h) => h.fav).lastIndexOf(false);
    if (idx === -1) break;
    history.splice(idx, 1);
  }
}

export function listHistory() {
  return history;
}

export function upsertHistory(entry) {
  const now = Date.now();
  if (entry.id) {
    const existing = history.find((h) => h.id === entry.id);
    if (existing) {
      Object.assign(existing, entry, { ts: now });
      history.sort((a, b) => b.ts - a.ts);
      persistHistory();
      return existing;
    }
  }
  const item = {
    id: entry.id || `${now}-${Math.random().toString(36).slice(2, 8)}`,
    src: entry.src,
    out: entry.out,
    from: entry.from,
    to: entry.to,
    fav: !!entry.fav,
    ts: now,
  };
  history.unshift(item);
  // حد أقصى للسجل (المفضلة لا تُحذف).
  let nonFav = history.filter((h) => !h.fav).length;
  for (let i = history.length - 1; i >= 0 && nonFav > MAX_HISTORY; i--) {
    if (!history[i].fav) {
      history.splice(i, 1);
      nonFav--;
    }
  }
  persistHistory();
  return item;
}

export function getHistory(id) {
  return history.find((h) => h.id === id) || null;
}

export function setFavorite(id, fav) {
  const item = getHistory(id);
  if (!item) return null;
  item.fav = fav;
  persistHistory();
  return item;
}

export function removeHistory(id) {
  history = history.filter((h) => h.id !== id);
  persistHistory();
}

export function clearHistory() {
  history = history.filter((h) => h.fav);
  persistHistory();
}

export function clearFavorites() {
  history.forEach((h) => { h.fav = false; });
  persistHistory();
}
