// Custom CSS for the server page (opt-in): custom.css next to the settings is put into the page
// after every load and again whenever the file changes. The lcd theme in resources/themes is an
// example the user can start from.

import { app, shell, type WebContents } from 'electron';
import { copyFileSync, existsSync, readFileSync, watch, writeFileSync, type FSWatcher } from 'node:fs';
import { join } from 'node:path';
import { log } from './log';
import { getSettings } from './settings';

const MAX_BYTES = 512 * 1024;

const cssPath = () => join(app.getPath('userData'), 'custom.css');
const examplePath = () => join(__dirname, '../../resources/themes/lcd.css');

let target: (() => WebContents | null) | null = null;
let insertedKey: string | null = null;
let watcher: FSWatcher | null = null;
let applyTimer: NodeJS.Timeout | null = null;

const readCss = () => {
  try {
    const css = readFileSync(cssPath(), 'utf8');
    return css.length > MAX_BYTES ? css.slice(0, MAX_BYTES) : css;
  } catch {
    return '';
  }
};

/** (re)applies the file to the page; removes it when the setting is off */
const applyCustomCss = async () => {
  const wc = target?.();
  if (!wc || wc.isDestroyed()) return;

  if (insertedKey) {
    await wc.removeInsertedCSS(insertedKey).catch(() => undefined);
    insertedKey = null;
  }
  if (!getSettings().customCss) return;

  const css = readCss();
  if (!css.trim()) return;
  try {
    insertedKey = await wc.insertCSS(css);
    log('css', `applied ${css.length} chars`);
  } catch (err) {
    log('css', (err as Error).message);
  }
};

const scheduleApply = () => {
  if (applyTimer) clearTimeout(applyTimer);
  applyTimer = setTimeout(() => void applyCustomCss(), 150);
};

const startWatching = () => {
  if (watcher) return;
  try {
    // the directory, not the file: editors replace the file instead of writing into it
    watcher = watch(app.getPath('userData'), (_event, name) => {
      if (name === 'custom.css') scheduleApply();
    });
    watcher.on('error', () => undefined);
  } catch (err) {
    log('css', 'watch:', (err as Error).message);
  }
};

/** the server page: applies on each load while the setting is on */
export const installCustomCss = (getPage: () => WebContents | null, wc: WebContents) => {
  target = getPage;
  insertedKey = null; // a new document has nothing of ours yet
  wc.on('did-finish-load', () => {
    insertedKey = null;
    void applyCustomCss();
  });
  if (getSettings().customCss) startWatching();
};

/** the setting changed */
export const refreshCustomCss = () => {
  if (getSettings().customCss) startWatching();
  void applyCustomCss();
};

/** opens custom.css in the default editor (created with the example when missing) */
export const editCustomCss = async () => {
  if (!existsSync(cssPath())) useExample();
  const err = await shell.openPath(cssPath());
  if (err) log('css', 'open:', err);
  return cssPath();
};

/** puts the lcd example in place of custom.css */
export const useExample = () => {
  try {
    copyFileSync(examplePath(), cssPath());
  } catch (err) {
    log('css', 'example:', (err as Error).message);
    writeFileSync(cssPath(), '/* custom css for the sharkord page */\n');
  }
  scheduleApply();
};

export const describeCustomCss = () => `custom css: ${getSettings().customCss ? `on, ${readCss().length} chars` : 'off'}`;
