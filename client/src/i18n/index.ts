import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import { th } from './locales/th.js';
import { en } from './locales/en.js';
import { zh } from './locales/zh.js';

export type AppLanguage = 'th' | 'en' | 'zh';
export const LANGUAGES: AppLanguage[] = ['th', 'en', 'zh'];

function initialLanguage(): AppLanguage {
  const stored = localStorage.getItem('language');
  return stored === 'en' || stored === 'zh' ? stored : 'th';
}

void i18next
  .use(initReactI18next)
  .init({
    resources: {
      th: { translation: th },
      en: { translation: en },
      zh: { translation: zh },
    },
    lng: initialLanguage(),
    fallbackLng: 'th',
    interpolation: { escapeValue: false },
  });

// CalendarPage อ่านค่านี้ (ผ่าน numberLocale()) เพื่อฟอร์แมตชื่อเดือน/วันแบบ Intl —
// ต้อง set ตั้งแต่ตอน init ไม่งั้น documentElement.lang จะว่าง แล้ว fallback เป็น 'th' เสมอ
document.documentElement.lang = initialLanguage();

export function setLanguage(lang: AppLanguage) {
  localStorage.setItem('language', lang);
  document.documentElement.lang = lang;
  void i18next.changeLanguage(lang);
}

export default i18next;
