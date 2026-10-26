// كشف لغة النص (عربي / إنجليزي) محلياً حسب نوع الحروف.
export function detectLanguage(text) {
  let ar = 0;
  let en = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0);
    if ((c >= 0x0600 && c <= 0x06ff) || (c >= 0x0750 && c <= 0x077f) ||
        (c >= 0x08a0 && c <= 0x08ff) || (c >= 0xfb50 && c <= 0xfdff) ||
        (c >= 0xfe70 && c <= 0xfeff)) {
      ar++;
    } else if ((c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a)) {
      en++;
    }
  }
  if (ar === 0 && en === 0) return null;
  return ar >= en ? 'ar' : 'en';
}

export const LANGS = {
  en: { code: 'en', name: 'الإنجليزية', native: 'English', dir: 'ltr', placeholder: 'Type English text…', empty: 'Translation' },
  ar: { code: 'ar', name: 'العربية', native: 'العربية', dir: 'rtl', placeholder: 'اكتبي النص العربي…', empty: 'الترجمة' },
};

export const other = (lang) => (lang === 'en' ? 'ar' : 'en');
