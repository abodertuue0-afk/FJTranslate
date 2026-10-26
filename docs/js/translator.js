// واجهة التواصل مع محرك الترجمة: Worker أولاً، والصفحة نفسها كخطة بديلة.

let worker = null;
let mode = null; // 'worker' | 'inline'
let engineModule = null;
let seq = 0;
const pending = new Map();

function startWorker() {
  return new Promise((resolve) => {
    try {
      worker = new Worker(new URL('./translator-worker.js', import.meta.url), { type: 'module' });
    } catch {
      resolve(false);
      return;
    }
    const timer = setTimeout(() => resolve(false), 8000);
    worker.onerror = () => {
      clearTimeout(timer);
      resolve(false);
    };
    worker.onmessage = (e) => {
      const msg = e.data || {};
      if (msg.type === 'pong' && msg.id === 0) {
        clearTimeout(timer);
        worker.onmessage = onWorkerMessage;
        worker.onerror = (err) => {
          for (const p of pending.values()) p.reject(new Error('WORKER_CRASHED'));
          pending.clear();
          if (err && err.preventDefault) err.preventDefault();
        };
        resolve(true);
      }
    };
    worker.postMessage({ id: 0, type: 'ping' });
  });
}

function onWorkerMessage(e) {
  const msg = e.data || {};
  const p = pending.get(msg.id);
  if (!p) return;
  if (msg.type === 'progress') p.onProgress && p.onProgress(msg.p);
  else if (msg.type === 'partial') p.onPartial && p.onPartial(msg.done, msg.total);
  else if (msg.type === 'error') { pending.delete(msg.id); p.reject(new Error(msg.message)); }
  else { pending.delete(msg.id); p.resolve(msg); }
}

async function ready() {
  if (mode) return;
  const ok = await startWorker();
  if (ok) {
    mode = 'worker';
  } else {
    if (worker) { try { worker.terminate(); } catch { /* */ } }
    worker = null;
    engineModule = await import('./engine.js');
    mode = 'inline';
  }
}

function call(type, payload = {}, hooks = {}) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, ...hooks });
    worker.postMessage({ id, type, ...payload });
  });
}

export async function downloadModel(key, onProgress) {
  await ready();
  if (mode === 'worker') return call('download', { key }, { onProgress });
  await engineModule.ensureModel(key, onProgress);
}

export async function translateText(key, text, onPartial) {
  await ready();
  if (mode === 'worker') return (await call('translate', { key, text }, { onPartial })).text;
  return engineModule.translate(key, text, onPartial);
}

export async function getModelStatus() {
  await ready();
  if (mode === 'worker') return (await call('status')).status;
  return engineModule.modelStatus();
}

export async function deleteModel(key) {
  await ready();
  if (mode === 'worker') return call('delete', { key });
  return engineModule.deleteModel(key);
}

export function engineMode() {
  return mode;
}

/** رسالة عربية واضحة لأي خطأ في الترجمة. */
export function explainError(err, online) {
  const m = String((err && err.message) || err || '');
  if (m === 'LIB_UNAVAILABLE') {
    return online
      ? 'تعذّر تحميل محرك الترجمة. أعيدي فتح التطبيق وجرّبي مرة أخرى.'
      : 'محرك الترجمة لم يُحفظ على الجهاز بعد. اتصلي بالإنترنت مرة واحدة واضغطي «تنزيل النموذج».';
  }
  if (/quota|QuotaExceeded|storage/i.test(m)) {
    return 'مساحة التخزين غير كافية. حرّري مساحة في الآيفون ثم أعيدي التنزيل.';
  }
  if (/fetch|network|Failed to load|NetworkError|Load failed/i.test(m)) {
    return online
      ? 'انقطع التنزيل. تأكدي من الاتصال وأعيدي المحاولة.'
      : 'النموذج غير منزّل بالكامل، ولا يوجد اتصال. اتصلي بالإنترنت وأكملي التنزيل من الإعدادات.';
  }
  if (/memory|RangeError|Out of memory|abort/i.test(m)) {
    return 'الذاكرة لم تكفِ. أغلقي التطبيقات الأخرى ثم أعيدي فتح مترجم نوسة.';
  }
  return 'تعذّرت الترجمة: ' + m;
}
