import i18next from './index.js';

// Maps the active UI language to a locale code for Number/Date formatting
// (Intl.NumberFormat / toLocaleString). The currency symbol itself (฿) is NOT
// locale-dependent here — THB stays THB regardless of UI language.
export function numberLocale(): string {
  switch (i18next.language) {
    case 'en': return 'en-US';
    case 'zh': return 'zh-CN';
    default: return 'th-TH';
  }
}
