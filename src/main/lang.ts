// the app's language in the main process (tray, prompts, dialogs): the setting, else the system's

import { app } from 'electron';
import { createT, pickLanguage, type TLang, type TTranslate } from '../shared/i18n';
import { getSettings } from './settings';

let lang: TLang | null = null;
let translate: TTranslate | null = null;
const listeners = new Set<() => void>();

export const currentLang = (): TLang => {
  if (!lang) {
    const system = app.isReady() ? app.getPreferredSystemLanguages() : [app.getLocale()];
    lang = pickLanguage(getSettings().language, system);
  }
  return lang;
};

/** translate for the main process; re-made when the language setting changes */
export const t: TTranslate = (text, vars) => (translate ??= createT(currentLang()))(text, vars);

export const onLanguageChange = () => {
  lang = null;
  translate = null;
  listeners.forEach((cb) => cb());
};

/** things that hold translated text (the tray menu) rebuild themselves here */
export const whenLanguageChanges = (cb: () => void) => listeners.add(cb);
