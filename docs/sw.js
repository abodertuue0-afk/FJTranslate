// Service Worker — مترجم نوسة
// يحفظ واجهة التطبيق ومكتباته على الجهاز ليعمل التطبيق دون إنترنت.
// ملفات نماذج الترجمة تحفظها مكتبة Transformers.js نفسها في Cache Storage (transformers-cache).

const VERSION = 'nousa-1.0.0';
const SHELL_CACHE = `shell-${VERSION}`;
const VENDOR_CACHE = 'nousa-vendor-v1';
const KEEP = [SHELL_CACHE, VENDOR_CACHE, 'transformers-cache'];

const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/styles.css',
  './js/app.js',
  './js/storage.js',
  './js/detect.js',
  './js/tts.js',
  './js/translator.js',
  './js/translator-worker.js',
  './js/engine.js',
  './js/importer.js',
  './js/ocr.js',
  './js/data/phrases.js',
  './js/data/legal.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './vendor/jszip/jszip.min.js',
  './vendor/pdfjs/pdf.min.mjs',
  './vendor/pdfjs/pdf.worker.min.mjs',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    // نخزّن كل ملف على حدة حتى لا يفشل التثبيت كله بسبب ملف واحد.
    await Promise.all(SHELL.map(async (url) => {
      try {
        const res = await fetch(url, { cache: 'reload' });
        if (res.ok) await cache.put(url, res);
      } catch { /* يُحاوَل لاحقاً */ }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((n) => !KEEP.includes(n)).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request, { ignoreSearch: true });
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok && (res.type === 'basic' || res.type === 'cors')) {
    cache.put(request, res.clone()).catch(() => {});
  }
  return res;
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request, { ignoreSearch: true });
  const network = fetch(request).then((res) => {
    if (res.ok && res.type === 'basic') cache.put(request, res.clone()).catch(() => {});
    return res;
  }).catch(() => null);
  if (hit) return hit;
  const res = await network;
  if (res) return res;
  return new Response('غير متاح دون إنترنت', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // فتح التطبيق: نعرض الواجهة المحفوظة فوراً (لا صفحة فارغة دون إنترنت).
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(SHELL_CACHE);
      const cached = (await cache.match('./index.html')) || (await cache.match('./'));
      const network = fetch(request).then((res) => {
        if (res.ok) cache.put('./index.html', res.clone()).catch(() => {});
        return res;
      }).catch(() => null);
      return cached || (await network) || new Response('<h1 dir="rtl">مترجم نوسة يحتاج فتحه مرة واحدة مع الإنترنت</h1>', {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    })());
    return;
  }

  if (url.origin === self.location.origin) {
    if (url.pathname.includes('/vendor/')) {
      event.respondWith(cacheFirst(request, VENDOR_CACHE));
    } else {
      event.respondWith(staleWhileRevalidate(request, SHELL_CACHE));
    }
    return;
  }

  // المكتبات الاحتياطية من CDN تُحفظ أيضاً.
  if (url.hostname === 'cdn.jsdelivr.net') {
    event.respondWith(cacheFirst(request, VENDOR_CACHE));
  }
  // طلبات huggingface.co تمر مباشرة؛ Transformers.js يحفظ النماذج بنفسه.
});
