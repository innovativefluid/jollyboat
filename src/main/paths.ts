import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const preloadPath = () => join(__dirname, '../preload/index.cjs');

/** the app icon for window title bars (linux/windows); the packaged icon is used for the taskbar */
export const iconPath = () => join(__dirname, '../../resources/icon.png');

const rendererRoot = () => pathToFileURL(join(__dirname, '../renderer/')).toString();

/** URL of one of our renderer pages (launcher | picker | prompt | bar), dev server or built file. */
export const pageUrl = (page: 'launcher' | 'picker' | 'prompt' | 'bar') => {
  const dev = process.env.ELECTRON_RENDERER_URL;

  if (dev) return `${dev}/${page}/index.html`;

  return `${rendererRoot()}${page}/index.html`;
};

export type TOwnPage = 'launcher' | 'picker' | 'prompt' | 'bar';

/** Which of our pages a url is (null for anything else). */
export const ownPageOf = (url: string): TOwnPage | null =>
  (['launcher', 'picker', 'prompt', 'bar'] as const).find((p) => url.startsWith(pageUrl(p).replace(/index\.html$/, ''))) ?? null;

/** True only for our own pages: the built renderer directory or the electron-vite dev server. */
export const isOwnPageUrl = (url: string) => {
  const dev = process.env.ELECTRON_RENDERER_URL;

  if (dev && url.startsWith(`${dev}/`)) return true;

  return url.startsWith(rendererRoot());
};

export const originOf = (url: string) => {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
};
