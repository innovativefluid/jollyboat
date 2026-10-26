// Saving files from the server page without another browser: a browser never has the server's
// proxy login (basic auth), so a picture or file opened there fails behind one. The app saves
// them itself, through its own session (which has the login), with a save dialog:
//  - a right-click menu on the page (save image / link / video, copy, and the spelling fixes)
//  - the save buttons the preload puts next to Sharkord's own links (preload/save-buttons.ts)
//  - on a server with a proxy login, Sharkord's "open in new tab" for its own files saves instead

import { app, clipboard, Menu, session, shell, type BaseWindow, type MenuItemConstructorOptions, type WebContents } from 'electron';
import { join } from 'node:path';
import { t } from './lang';
import { log } from './log';
import { findServerByUrl } from './settings';

/** one of the server's own files (sharkord serves uploads under /public/), from the same server as the page */
export const isServerFile = (url: string, pageUrl: string) => {
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol) || !u.pathname.startsWith('/public/')) return false;
    if (u.origin === new URL(pageUrl).origin) return true;
    const a = findServerByUrl(url);
    return !!a && a.id === findServerByUrl(pageUrl)?.id;
  } catch {
    return false;
  }
};

const savable = (url: string) => /^(https?:|blob:|data:)/i.test(url);

/** saves the url through the page's session: a save dialog, the downloads folder offered */
export const saveUrl = (wc: WebContents, url: string) => {
  if (!savable(url) || wc.isDestroyed()) return;
  wc.downloadURL(url);
};

export const installDownloads = () => {
  session.defaultSession.on('will-download', (_e, item) => {
    item.setSaveDialogOptions({ title: t('Save'), defaultPath: join(app.getPath('downloads'), item.getFilename() || 'download') });
    item.once('done', (_ev, state) => log('download', state));
  });
};

/** the right-click menu of the server page */
export const installContextMenu = (wc: WebContents, win: BaseWindow) => {
  wc.on('context-menu', (_e, p) => {
    const items: MenuItemConstructorOptions[] = [];
    const group = (list: MenuItemConstructorOptions[]) => {
      if (!list.length) return;
      if (items.length) items.push({ type: 'separator' });
      items.push(...list);
    };

    if (p.misspelledWord) {
      group([
        ...p.dictionarySuggestions.slice(0, 5).map((s) => ({ label: s, click: () => wc.replaceMisspelling(s) })),
        { label: t('Add to dictionary'), click: () => wc.session.addWordToSpellCheckerDictionary(p.misspelledWord) }
      ]);
    }

    if (p.mediaType === 'image' && p.srcURL && savable(p.srcURL)) {
      group([
        { label: t('Save image as…'), click: () => saveUrl(wc, p.srcURL) },
        { label: t('Copy image'), click: () => wc.copyImageAt(p.x, p.y) },
        ...(/^https?:/i.test(p.srcURL) ? [{ label: t('Copy image address'), click: () => clipboard.writeText(p.srcURL) }] : [])
      ]);
    } else if ((p.mediaType === 'video' || p.mediaType === 'audio') && p.srcURL && savable(p.srcURL)) {
      group([{ label: p.mediaType === 'video' ? t('Save video as…') : t('Save audio as…'), click: () => saveUrl(wc, p.srcURL) }]);
    }

    if (p.linkURL && /^https?:/i.test(p.linkURL)) {
      group([
        { label: t('Save link as…'), click: () => saveUrl(wc, p.linkURL) },
        { label: t('Copy link address'), click: () => clipboard.writeText(p.linkURL) },
        { label: t('Open link in browser'), click: () => shell.openExternal(p.linkURL) }
      ]);
    }

    if (p.isEditable) {
      group([
        { label: t('Cut'), role: 'cut', enabled: p.editFlags.canCut },
        { label: t('Copy'), role: 'copy', enabled: p.editFlags.canCopy },
        { label: t('Paste'), role: 'paste', enabled: p.editFlags.canPaste },
        { type: 'separator' },
        { label: t('Select all'), role: 'selectAll' }
      ]);
    } else if (p.selectionText.trim()) {
      group([{ label: t('Copy'), role: 'copy' }]);
    }

    // (the window given: the page is a view in it, and nothing may have focus yet)
    if (items.length && !win.isDestroyed()) Menu.buildFromTemplate(items).popup({ window: win });
  });
};
