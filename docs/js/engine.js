// محرك الترجمة المحلي: Transformers.js + نماذج Opus-MT (Helsinki-NLP) بصيغة ONNX مضغوطة (q8).
// يعمل داخل Web Worker (أو في الصفحة كخطة بديلة). بعد التنزيل الأول تُحفظ ملفات النموذج
// في Cache Storage على الجهاز، وتتم الترجمة كاملة دون إنترنت.

export const MODELS = {
  'en-ar': { id: 'Xenova/opus-mt-en-ar', prefix: '>>ara<< ', label: 'الإنجليزية ← العربية' },
  'ar-en': { id: 'Xenova/opus-mt-ar-en', prefix: '', label: 'العربية ← الإنجليزية' },
};

const MODEL_FILES = [
  'config.json',
  'tokenizer.json',
  'onnx/encoder_model_quantized.onnx',
  'onnx/decoder_model_merged_quantized.onnx',
];

export const MODEL_CACHE = 'transformers-cache';
export const VENDOR_CACHE = 'nousa-vendor-v1';
const CDN_TRANSFORMERS = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3';

const VENDOR_BASE = new URL('../vendor/', import.meta.url).href;

let lib = null;
let libSource = null;
let active = { key: null, pipe: null };
let loading = null;

/** يجعل ملفات المكتبة (wasm…) تُقرأ من التخزين المحلي أولاً، حتى لو لم يعترضها Service Worker. */
function installVendorFetchCache() {
  if (self.__nousaFetchPatched || typeof caches === 'undefined') return;
  self.__nousaFetchPatched = true;
  const original = self.fetch.bind(self);
  self.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : (input && input.url) || String(input);
    const isVendor = url.startsWith(VENDOR_BASE) || url.startsWith('https://cdn.jsdelivr.net/');
    if (!isVendor || (init && init.method && init.method !== 'GET')) return original(input, init);
    try {
      const cache = await caches.open(VENDOR_CACHE);
      const hit = await cache.match(url);
      if (hit) return hit;
      const res = await original(input, init);
      if (res.ok) cache.put(url, res.clone()).catch(() => {});
      return res;
    } catch {
      return original(input, init);
    }
  };
}

export async function loadLibrary() {
  if (lib) return lib;
  installVendorFetchCache();
  try {
    lib = await import(VENDOR_BASE + 'transformers.bundle.js');
    libSource = 'local';
  } catch (localError) {
    try {
      lib = await import(CDN_TRANSFORMERS);
      libSource = 'cdn';
    } catch (cdnError) {
      throw new Error('LIB_UNAVAILABLE');
    }
  }
  const { env } = lib;
  env.allowLocalModels = false;
  env.allowRemoteModels = true;
  env.useBrowserCache = true;
  if (env.backends && env.backends.onnx && env.backends.onnx.wasm) {
    env.backends.onnx.wasm.numThreads = 1; // GitHub Pages لا يدعم Cross-Origin Isolation
    env.backends.onnx.wasm.proxy = false;
    if (libSource === 'local') env.backends.onnx.wasm.wasmPaths = VENDOR_BASE + 'ort/';
  }
  return lib;
}

/** تحميل نموذج اتجاه واحد (نُبقي نموذجاً واحداً في الذاكرة لتوفير ذاكرة الآيفون). */
export async function ensureModel(key, onProgress) {
  if (!MODELS[key]) throw new Error('BAD_DIRECTION');
  if (active.key === key && active.pipe) return active.pipe;
  if (loading && loading.key === key) return loading.promise;

  if (active.pipe) {
    try { await active.pipe.dispose(); } catch { /* تجاهل */ }
    active = { key: null, pipe: null };
  }

  const promise = (async () => {
    const T = await loadLibrary();
    return T.pipeline('translation', MODELS[key].id, {
      dtype: 'q8',
      device: 'wasm',
      progress_callback: (p) => {
        if (onProgress) {
          onProgress({ status: p.status, file: p.file, loaded: p.loaded, total: p.total, progress: p.progress });
        }
      },
    });
  })();

  loading = { key, promise };
  try {
    const pipe = await promise;
    active = { key, pipe };
    return pipe;
  } finally {
    if (loading && loading.key === key) loading = null;
  }
}

/** تقسيم النص إلى جمل قصيرة مع الحفاظ على الأسطر. */
export function segment(text) {
  const lines = text.split('\n');
  return lines.map((line) => {
    if (!line.trim()) return [];
    const parts = line.match(/[^.!?؟؛;\n]+[.!?؟؛;]*\s*/g) || [line];
    const out = [];
    let buf = '';
    for (const part of parts) {
      if ((buf + part).length > 280 && buf) {
        out.push(buf.trim());
        buf = '';
      }
      buf += part;
    }
    if (buf.trim()) out.push(buf.trim());
    return out;
  });
}

export async function translate(key, text, onPartial) {
  const pipe = await ensureModel(key);
  const prefix = MODELS[key].prefix;
  const lines = segment(text);
  const total = lines.reduce((n, l) => n + l.length, 0);
  let done = 0;
  const outLines = [];
  for (const sentences of lines) {
    const translated = [];
    for (const s of sentences) {
      const result = await pipe(prefix + s, { max_new_tokens: 400 });
      const value = Array.isArray(result) ? result[0] : result;
      translated.push(((value && value.translation_text) || '').trim());
      done++;
      if (onPartial) onPartial(done, total);
    }
    outLines.push(translated.join(' '));
  }
  return outLines.join('\n');
}

/** هل ملفات النموذج موجودة في تخزين الجهاز؟ */
export async function modelStatus() {
  const status = {};
  let urls = [];
  if (typeof caches !== 'undefined') {
    try {
      const cache = await caches.open(MODEL_CACHE);
      const keys = await cache.keys();
      urls = keys.map((r) => r.url);
      status._bytes = {};
      for (const [key, m] of Object.entries(MODELS)) {
        let bytes = 0;
        for (const req of keys) {
          if (req.url.includes(`/${m.id}/`)) {
            const res = await cache.match(req);
            bytes += Number((res && res.headers.get('content-length')) || 0);
          }
        }
        status._bytes[key] = bytes;
      }
    } catch { /* لا شيء */ }
  }
  for (const [key, m] of Object.entries(MODELS)) {
    status[key] = MODEL_FILES.every((f) => urls.some((u) => u.includes(`/${m.id}/`) && u.endsWith('/' + f)));
  }
  status.loaded = active.key;
  status.libSource = libSource;
  return status;
}

export async function deleteModel(key) {
  if (active.key === key && active.pipe) {
    try { await active.pipe.dispose(); } catch { /* تجاهل */ }
    active = { key: null, pipe: null };
  }
  if (typeof caches === 'undefined') return;
  const cache = await caches.open(MODEL_CACHE);
  const keys = await cache.keys();
  await Promise.all(keys.filter((r) => r.url.includes(`/${MODELS[key].id}/`)).map((r) => cache.delete(r)));
}
