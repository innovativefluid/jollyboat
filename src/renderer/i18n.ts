// our pages: translate the static markup once, and give scripts t() for what they build

import { createT, type TLang } from '../shared/i18n';

const lang: TLang = window.shell.lang;
export const t = createT(lang);

/** elements marked data-i18n get their text translated; -title / -placeholder likewise */
export const translatePage = () => {
  document.documentElement.lang = lang;
  for (const el of document.querySelectorAll<HTMLElement>('[data-i18n]')) {
    const key = el.dataset.i18n || el.textContent?.trim() || '';
    if (key) el.textContent = t(key);
  }
  for (const el of document.querySelectorAll<HTMLElement>('[data-i18n-title]')) el.title = t(el.dataset.i18nTitle || el.title);
  for (const el of document.querySelectorAll<HTMLInputElement>('[data-i18n-placeholder]')) el.placeholder = t(el.dataset.i18nPlaceholder || el.placeholder);
};
