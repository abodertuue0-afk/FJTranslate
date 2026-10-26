// قراءة النص من الصور (OCR) عبر Tesseract.js — يعمل على الجهاز بعد تنزيل ملفاته مرة واحدة.

const VENDOR = new URL('../vendor/', import.meta.url).href;
const CDN_TESSERACT = 'https://cdn.jsdelivr.net/npm/tesseract.js@6/dist/tesseract.min.js';

export const OCR_FILES = [
  'tesseract/tesseract.min.js',
  'tesseract/worker.min.js',
  'tesseract/tesseract-core-lstm.wasm.js',
  'tesseract/tesseract-core-simd-lstm.wasm.js',
  'tessdata/ara.traineddata.gz',
  'tessdata/eng.traineddata.gz',
];

let libPromise = null;
let source = null;
let worker = null;
let workerLang = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = resolve;
    s.onerror = () => reject(new Error('SCRIPT_FAILED'));
    document.head.appendChild(s);
  });
}

async function loadLib() {
  if (window.Tesseract) return window.Tesseract;
  if (!libPromise) {
    libPromise = (async () => {
      try {
        await loadScript(VENDOR + 'tesseract/tesseract.min.js');
        source = 'local';
      } catch {
        await loadScript(CDN_TESSERACT);
        source = 'cdn';
      }
      if (!window.Tesseract) throw new Error('OCR_UNAVAILABLE');
      return window.Tesseract;
    })().catch((e) => {
      libPromise = null;
      throw e;
    });
  }
  return libPromise;
}

async function getWorker(lang, onProgress) {
  const T = await loadLib();
  if (worker && workerLang === lang) return worker;
  if (worker) {
    try { await worker.terminate(); } catch { /* */ }
    worker = null;
  }
  const options = {
    logger: (m) => onProgress && onProgress(m),
    cacheMethod: 'write',
  };
  if (source === 'local') {
    options.workerPath = VENDOR + 'tesseract/worker.min.js';
    options.corePath = VENDOR + 'tesseract';
    options.langPath = VENDOR + 'tessdata';
    // عامل من ملف على نفس الموقع (وليس blob) حتى يخدمه Service Worker دون إنترنت.
    options.workerBlobURL = false;
  }
  worker = await T.createWorker(lang === 'ar' ? 'ara' : 'eng', 1, options);
  workerLang = lang;
  return worker;
}

/** تصغير الصورة الكبيرة لتوفير ذاكرة الآيفون. */
async function prepareImage(blob) {
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('IMAGE_FAILED'));
      i.src = url;
    });
    const max = 2000;
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** قراءة نص من صورة (Blob أو Canvas). */
export async function recognize(input, lang, onProgress) {
  const image = input instanceof HTMLCanvasElement ? input : await prepareImage(input);
  const w = await getWorker(lang, onProgress);
  const { data } = await w.recognize(image);
  return (data && data.text ? data.text : '').replace(/\n{3,}/g, '\n\n').trim();
}

/** تجهيز OCR للعمل دون إنترنت: تنزيل الملفات ثم تشغيل تجريبي صغير لكل لغة. */
export async function prepareOffline(onStep) {
  const cache = await caches.open('nousa-vendor-v1');
  for (const file of OCR_FILES) {
    const url = VENDOR + file;
    onStep && onStep(`تنزيل ${file.split('/').pop()}`);
    const hit = await cache.match(url);
    if (!hit) {
      try {
        const res = await fetch(url, { cache: 'reload' });
        if (res.ok) await cache.put(url, res.clone());
      } catch { /* قد لا تكون الملفات المحلية متاحة؛ سيستخدم المتصفح CDN */ }
    }
  }
  for (const lang of ['en', 'ar']) {
    onStep && onStep(lang === 'ar' ? 'تجهيز قراءة العربية' : 'تجهيز قراءة الإنجليزية');
    const canvas = document.createElement('canvas');
    canvas.width = 420;
    canvas.height = 120;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, 420, 120);
    ctx.fillStyle = '#000';
    ctx.font = 'bold 48px sans-serif';
    ctx.direction = lang === 'ar' ? 'rtl' : 'ltr';
    ctx.textAlign = 'center';
    ctx.fillText(lang === 'ar' ? 'مرحبا' : 'Hello', 210, 78);
    await recognize(canvas, lang);
  }
}

export async function isPrepared() {
  if (typeof caches === 'undefined') return false;
  const cache = await caches.open('nousa-vendor-v1');
  for (const file of ['tessdata/ara.traineddata.gz', 'tessdata/eng.traineddata.gz', 'tesseract/worker.min.js']) {
    if (!(await cache.match(VENDOR + file))) return false;
  }
  return true;
}
