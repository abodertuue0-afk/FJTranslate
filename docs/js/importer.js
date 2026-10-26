// استيراد الملفات: نص، Word (.docx)، PDF، وصور (عبر OCR). كل المعالجة على الجهاز.
import { recognize } from './ocr.js';

const VENDOR = new URL('../vendor/', import.meta.url).href;
const MAX_BYTES = 20 * 1024 * 1024;
export const MAX_CHARS = 5000;

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function ext(name) {
  const m = /\.([a-z0-9]+)$/i.exec(name || '');
  return m ? m[1].toLowerCase() : '';
}

async function loadJSZip() {
  if (window.JSZip) return window.JSZip;
  await new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = VENDOR + 'jszip/jszip.min.js';
    s.onload = resolve;
    s.onerror = () => reject(new Error('JSZIP_FAILED'));
    document.head.appendChild(s);
  });
  return window.JSZip;
}

async function readDocx(file) {
  const JSZip = await loadJSZip();
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const entry = zip.file('word/document.xml');
  if (!entry) throw new Error('DOCX_INVALID');
  const xml = new DOMParser().parseFromString(await entry.async('string'), 'application/xml');
  const paragraphs = xml.getElementsByTagNameNS(W_NS, 'p');
  const lines = [];
  for (const p of paragraphs) {
    let line = '';
    const walker = xml.createTreeWalker(p, NodeFilter.SHOW_ELEMENT);
    let node = walker.currentNode;
    while (node) {
      if (node.namespaceURI === W_NS) {
        if (node.localName === 't') line += node.textContent;
        else if (node.localName === 'tab') line += '\t';
        else if (node.localName === 'br') line += '\n';
      }
      node = walker.nextNode();
    }
    lines.push(line);
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

let pdfjs = null;
async function loadPdfJs() {
  if (pdfjs) return pdfjs;
  pdfjs = await import(VENDOR + 'pdfjs/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = VENDOR + 'pdfjs/pdf.worker.min.mjs';
  return pdfjs;
}

async function readPdf(file, lang, onStatus) {
  const lib = await loadPdfJs();
  const task = lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false });
  const doc = await task.promise;
  const maxPages = Math.min(doc.numPages, 40);
  let text = '';
  for (let i = 1; i <= maxPages; i++) {
    onStatus && onStatus(`قراءة الصفحة ${i} من ${doc.numPages}`);
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    let line = '';
    for (const item of content.items) {
      line += item.str;
      if (item.hasEOL) { text += line + '\n'; line = ''; }
      else if (item.str && !item.str.endsWith(' ')) line += ' ';
    }
    text += line + '\n\n';
    if (text.length > MAX_CHARS * 1.5) break;
  }
  text = text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

  // PDF ممسوح ضوئياً (بلا نص): نقرأ أول 3 صفحات بالـ OCR.
  if (!text) {
    const pages = Math.min(doc.numPages, 3);
    for (let i = 1; i <= pages; i++) {
      onStatus && onStatus(`قراءة صورة الصفحة ${i} (OCR)`);
      const page = await doc.getPage(i);
      const viewport = page.getViewport({ scale: 2 });
      const canvas = document.createElement('canvas');
      canvas.width = Math.min(2400, viewport.width);
      canvas.height = Math.round(viewport.height * (canvas.width / viewport.width));
      const scaled = page.getViewport({ scale: 2 * (canvas.width / viewport.width) });
      await page.render({ canvasContext: canvas.getContext('2d'), viewport: scaled }).promise;
      text += (await recognize(canvas, lang)) + '\n\n';
    }
    text = text.trim();
  }
  try { await task.destroy(); } catch { /* تجاهل */ }
  return text;
}

/**
 * يقرأ ملفاً ويعيد { text, truncated, kind }.
 * lang: لغة المصدر المتوقعة (للـ OCR).
 */
export async function importFile(file, lang, onStatus) {
  if (file.size > MAX_BYTES) throw new Error('FILE_TOO_LARGE');
  const e = ext(file.name);
  const type = file.type || '';
  let text = '';
  let kind = '';

  if (type.startsWith('image/') || ['jpg', 'jpeg', 'png', 'heic', 'heif', 'webp', 'gif', 'bmp'].includes(e)) {
    kind = 'image';
    onStatus && onStatus('قراءة النص من الصورة…');
    text = await recognize(file, lang, (m) => {
      if (m && m.status === 'recognizing text') onStatus && onStatus(`قراءة النص ${Math.round((m.progress || 0) * 100)}%`);
    });
  } else if (e === 'docx') {
    kind = 'docx';
    onStatus && onStatus('قراءة ملف Word…');
    text = await readDocx(file);
  } else if (e === 'pdf' || type === 'application/pdf') {
    kind = 'pdf';
    text = await readPdf(file, lang, onStatus);
  } else if (['txt', 'md', 'csv', 'srt', 'text', 'rtf'].includes(e) || type.startsWith('text/')) {
    kind = 'text';
    text = await file.text();
    if (e === 'rtf') text = text.replace(/\\[a-z]+-?\d* ?|[{}]/gi, '');
  } else if (e === 'doc') {
    throw new Error('DOC_OLD');
  } else {
    throw new Error('UNSUPPORTED');
  }

  text = (text || '').replace(/\r\n?/g, '\n').trim();
  const truncated = text.length > MAX_CHARS;
  return { text: truncated ? text.slice(0, MAX_CHARS) : text, truncated, kind };
}

export function explainImportError(err) {
  const m = String((err && err.message) || err);
  if (m === 'FILE_TOO_LARGE') return 'الملف أكبر من 20 ميغابايت.';
  if (m === 'DOC_OLD') return 'صيغة .doc القديمة غير مدعومة. احفظي الملف بصيغة .docx أو PDF.';
  if (m === 'UNSUPPORTED') return 'الصيغة غير مدعومة. المدعوم: TXT، DOCX، PDF، والصور.';
  if (m === 'DOCX_INVALID') return 'ملف Word تالف أو غير صالح.';
  if (m === 'OCR_UNAVAILABLE' || m === 'SCRIPT_FAILED') return 'قارئ الصور غير مُجهّز بعد. اتصلي بالإنترنت واضغطي «تجهيز قراءة الصور» في الإعدادات.';
  if (m === 'IMAGE_FAILED') return 'تعذّر فتح الصورة.';
  if (/password/i.test(m)) return 'ملف PDF محمي بكلمة مرور.';
  return 'تعذّر قراءة الملف: ' + m;
}
