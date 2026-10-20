// a modal yes/no window in the app's own look (src/renderer/prompt), replacing native message boxes

import { BrowserWindow, ipcMain, type BaseWindow } from 'electron';
import { iconPath, isOwnPageUrl, pageUrl, preloadPath } from './paths';

type TPrompt = { message: string; detail?: string; yes: string; no: string };

let promptWindow: BrowserWindow | null = null;
let resolveAnswer: ((answer: boolean) => void) | null = null;

export const askPrompt = (parent: BaseWindow | undefined, prompt: TPrompt) =>
  new Promise<boolean>((resolve) => {
    // one question at a time; a second one gets the first one's "no"
    if (promptWindow) return resolve(false);
    resolveAnswer = resolve;

    const query = new URLSearchParams({ message: prompt.message, detail: prompt.detail ?? '', yes: prompt.yes, no: prompt.no });

    promptWindow = new BrowserWindow({
      width: 460,
      height: 190,
      parent,
      modal: !!parent,
      show: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      autoHideMenuBar: true,
      icon: iconPath(),
      title: 'Jollyboat',
      backgroundColor: '#a6b08a',
      webPreferences: { preload: preloadPath(), sandbox: true, contextIsolation: true }
    });
    promptWindow.setMenuBarVisibility(false);
    promptWindow.once('ready-to-show', () => promptWindow?.show());
    promptWindow.on('closed', () => {
      promptWindow = null;
      resolveAnswer?.(false);
      resolveAnswer = null;
    });
    promptWindow.loadURL(`${pageUrl('prompt')}?${query}`);
  });

ipcMain.on('prompt:answer', (event, answer: unknown) => {
  if (event.sender !== promptWindow?.webContents || !isOwnPageUrl(event.senderFrame?.url ?? '')) return;

  resolveAnswer?.(answer === true);
  resolveAnswer = null;
  promptWindow?.close();
});
