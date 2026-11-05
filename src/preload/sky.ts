// the Pixel Sky theme: the sky behind the Sharkord page (the theme's css draws the panels in
// front of it). Night or day follows the page's own light / dark.

import { createSky, type TSky } from '../renderer/theme/sky/sky';

export const startPageSky = (focused: () => boolean): TSky | null => {
  if (!document.body) return null;
  const canvas = document.createElement('canvas');
  canvas.className = 'jb-sky';
  canvas.style.cssText = 'position:fixed;left:0;top:0;z-index:-1;pointer-events:none;image-rendering:pixelated;';
  document.body.prepend(canvas);
  const sky = createSky(canvas, {
    scheme: () => (document.documentElement.classList.contains('light') ? 'day' : 'night'),
    focused,
    // over the chat, which is open sky (the member list would hide it at the right)
    orb: 0.62
  });
  return {
    ...sky,
    stop: () => {
      sky.stop();
      canvas.remove();
    }
  };
};
