import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const preloadPath = () => join(__dirname, '../preload/index.cjs');

const rendererRoot = () => pathToFileURL(join(__dirname, '../renderer/')).toString();

/** URL of one of our renderer pages (launcher | picker), dev server or built file. */
export const pageUrl = (page: 'launcher' | 'picker') => {
  const dev = process.env.ELECTRON_RENDERER_URL;

  if (dev) return `${dev}/${page}/index.html`;

  return `${rendererRoot()}${page}/index.html`;
};

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
