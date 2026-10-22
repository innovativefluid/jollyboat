// Pop-out stream: a screen share (or camera) someone is sending goes into a small always-on-top
// window of its own (Chromium's picture-in-picture), so it stays in view over a game or another
// app. The page reports how many stream videos are playing; the bar shows the button then.

import type { WebContents } from 'electron';
import { log } from './log';

let streams = 0;
let mainPage: (() => WebContents | null) | null = null;
const listeners = new Set<() => void>();

export const bindMainPage = (get: () => WebContents | null) => {
  mainPage = get;
};
export const getMainPage = () => mainPage?.() ?? null;

export const streamCount = () => streams;
export const onStreams = (cb: () => void) => listeners.add(cb);
export const setStreams = (n: number) => {
  if (n === streams) return;
  streams = n;
  listeners.forEach((cb) => cb());
};

// runs in the page with a user gesture (picture-in-picture needs one): the largest playing
// stream goes into the pip window; a second call brings it back
const POP_OUT = `(() => {
  if (document.pictureInPictureElement) { document.exitPictureInPicture(); return 'back'; }
  const videos = [...document.querySelectorAll('video')]
    .filter((v) => v.srcObject && v.readyState >= 2 && v.videoWidth > 0 && !v.disablePictureInPicture)
    .sort((a, b) => b.videoWidth * b.videoHeight - a.videoWidth * a.videoHeight);
  if (!videos.length) return 'none';
  return videos[0].requestPictureInPicture().then(() => 'out', (e) => 'error ' + e.name);
})()`;

export const popOutStream = async () => {
  const wc = getMainPage();
  if (!wc || wc.isDestroyed()) return;
  try {
    const result = await wc.executeJavaScript(POP_OUT, true);
    log('popout', String(result));
  } catch (err) {
    log('popout', (err as Error).message);
  }
};
