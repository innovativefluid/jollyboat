// A theme on the server page (opt-in): the app's own lcd look (resources/themes/lcd.css), the
// water look (resources/themes/water.css) or custom.css next to the settings. Put into the page after every load, and for custom.css
// again whenever the file changes. `url("jollyboat-font:Name")` in either becomes one of the
// app's bundled fonts as a data url (Sharkord's own content policy allows those).

import { app, shell, type WebContents } from 'electron';
import { copyFileSync, existsSync, readdirSync, readFileSync, watch, writeFileSync, type FSWatcher } from 'node:fs';
import { join } from 'node:path';
import { log } from './log';
import { getSettings } from './settings';

const MAX_BYTES = 1024 * 1024;
const FONTS = ['PixelifySans', 'Fredoka', 'Jersey10', 'Nunito'];

const cssPath = () => join(app.getPath('userData'), 'custom.css');
const themePath = (name: 'lcd' | 'water' = 'lcd') => join(__dirname, `../../resources/themes/${name}.css`);
const assetsDir = () => join(__dirname, '../renderer/assets');

let target: (() => WebContents | null) | null = null;
let insertedKey: string | null = null;
let watcher: FSWatcher | null = null;
let applyTimer: NodeJS.Timeout | null = null;
const fontCache = new Map<string, string>();

/** one of our fonts as a data url (the build gives the file a hash: found by its name) */
const fontDataUrl = (name: string) => {
  if (!FONTS.includes(name)) return '';
  const cached = fontCache.get(name);
  if (cached) return cached;
  try {
    const file = readdirSync(assetsDir()).find((f) => f.startsWith(`${name}-`) && f.endsWith('.ttf'));
    if (!file) return '';
    const url = `data:font/ttf;base64,${readFileSync(join(assetsDir(), file)).toString('base64')}`;
    fontCache.set(name, url);
    return url;
  } catch {
    return '';
  }
};

const withFonts = (css: string) => css.replace(/url\(\s*["']?jollyboat-font:([A-Za-z0-9]+)["']?\s*\)/g, (_m, name: string) => `url("${fontDataUrl(name)}")`);

const readFile = (path: string) => {
  try {
    const css = readFileSync(path, 'utf8');
    return css.length > MAX_BYTES ? css.slice(0, MAX_BYTES) : css;
  } catch {
    return '';
  }
};

const themeCss = () => {
  const { theme } = getSettings();
  if (theme === 'jollyboat') return readFile(themePath('lcd'));
  if (theme === 'water') return readFile(themePath('water'));
  if (theme === 'custom') return readFile(cssPath());
  return '';
};

/** (re)applies the theme to the page; removes it when the setting is off */
const applyTheme = async () => {
  const wc = target?.();
  if (!wc || wc.isDestroyed()) return;

  if (insertedKey) {
    await wc.removeInsertedCSS(insertedKey).catch(() => undefined);
    insertedKey = null;
  }
  const css = themeCss();
  if (!css.trim()) return;
  try {
    insertedKey = await wc.insertCSS(withFonts(css));
    log('theme', `${getSettings().theme}: applied ${css.length} chars`);
  } catch (err) {
    log('theme', (err as Error).message);
  }
};

const scheduleApply = () => {
  if (applyTimer) clearTimeout(applyTimer);
  applyTimer = setTimeout(() => void applyTheme(), 150);
};

const startWatching = () => {
  if (watcher) return;
  try {
    // the directory, not the file: editors replace the file instead of writing into it
    watcher = watch(app.getPath('userData'), (_event, name) => {
      if (name === 'custom.css' && getSettings().theme === 'custom') scheduleApply();
    });
    watcher.on('error', () => undefined);
  } catch (err) {
    log('theme', 'watch:', (err as Error).message);
  }
};

/** the server page: applies on each load while a theme is chosen */
export const installCustomCss = (getPage: () => WebContents | null, wc: WebContents) => {
  target = getPage;
  insertedKey = null; // a new document has nothing of ours yet
  wc.on('did-finish-load', () => {
    insertedKey = null;
    void applyTheme();
  });
  if (getSettings().theme === 'custom') startWatching();
};

/** the setting changed */
export const refreshCustomCss = () => {
  if (getSettings().theme === 'custom') startWatching();
  void applyTheme();
};

/** opens custom.css in the default editor (started from the lcd theme when missing) */
export const editCustomCss = async () => {
  if (!existsSync(cssPath())) useExample();
  const err = await shell.openPath(cssPath());
  if (err) log('theme', 'open:', err);
  return cssPath();
};

/** puts the lcd theme in place of custom.css, as a starting point */
export const useExample = () => {
  try {
    copyFileSync(themePath(), cssPath());
  } catch (err) {
    log('theme', 'example:', (err as Error).message);
    writeFileSync(cssPath(), '/* custom css for the sharkord page */\n');
  }
  scheduleApply();
};

export const describeCustomCss = () => {
  const { theme } = getSettings();
  return `theme: ${theme}${theme === 'custom' ? ` (${readFile(cssPath()).length} chars)` : ''}`;
};
