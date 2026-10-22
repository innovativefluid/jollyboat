// The app's own words in the user's language (the Sharkord page translates itself). English is
// the key: a dictionary maps each English string to its translation, anything missing stays
// English. `{name}` in a string is filled from the second argument.

import de from './locales/de.json';
import pl from './locales/pl.json';

export type TLang = 'en' | 'de' | 'pl';
export type TLanguageSetting = 'system' | TLang;

export const LANGS: readonly TLang[] = ['en', 'de', 'pl'];
export const LANG_NAMES: Record<TLang, string> = { en: 'English', de: 'Deutsch', pl: 'Polski' };

const dictionaries: Record<TLang, Record<string, string>> = { en: {}, de, pl };

/** the language to use: the setting, or the first system language we have */
export const pickLanguage = (setting: TLanguageSetting, system: readonly string[]): TLang => {
  if (setting !== 'system') return setting;
  for (const tag of system) {
    const base = tag.toLowerCase().split(/[-_]/)[0] as TLang;
    if (LANGS.includes(base)) return base;
  }
  return 'en';
};

export type TTranslate = (text: string, vars?: Record<string, string | number>) => string;

export const createT = (lang: TLang): TTranslate => {
  const dict = dictionaries[lang] ?? {};
  return (text, vars) => {
    let out = dict[text] ?? text;
    if (vars) for (const [k, v] of Object.entries(vars)) out = out.split(`{${k}}`).join(String(v));
    return out;
  };
};
